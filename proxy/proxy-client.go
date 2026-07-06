package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"time"
)

type Config struct {
	Host     string
	Port     int
	Interval int
}

type Command struct {
	CmdID   string `json:"cmdId"`
	Command string `json:"command"`
	Timeout int    `json:"timeout"`
}

type Result struct {
	CmdID  string `json:"cmdId"`
	Output string `json:"output"`
	Error  string `json:"error"`
}

func main() {
	cfg := Config{}
	flag.StringVar(&cfg.Host, "host", "127.0.0.1", "proxy server host")
	flag.IntVar(&cfg.Port, "port", 9999, "proxy server port")
	flag.IntVar(&cfg.Interval, "interval", 3000, "poll interval (ms)")
	flag.Parse()

	hn, _ := os.Hostname()
	sessionID := fmt.Sprintf("%s-%d", hn, os.Getpid())
	base := fmt.Sprintf("http://%s:%d", cfg.Host, cfg.Port)

	log.Printf("proxy-client start (server=%s id=%s)", base, sessionID)

	for !register(base, sessionID, hn) {
		log.Printf("register failed, retry in 5s")
		time.Sleep(5 * time.Second)
	}
	log.Printf("registered, polling every %dms", cfg.Interval)

	for {
		cmd := poll(base, sessionID)
		if cmd != nil {
			log.Printf("exec: %s", cmd.Command)
			out, errStr := runCmd(cmd)
			sendResult(base, sessionID, cmd.CmdID, out, errStr)
		}
		time.Sleep(time.Duration(cfg.Interval) * time.Millisecond)
	}
}

func register(base, id, hostname string) bool {
	data := fmt.Sprintf(`{"id":"%s","hostname":"%s"}`, id, hostname)
	resp, err := http.Post(base+"/register", "application/json", bytes.NewReader([]byte(data)))
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == 200
}

func poll(base, id string) *Command {
	resp, err := http.Get(base + "/poll/" + id)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}
	var cmd Command
	if json.Unmarshal(data, &cmd) != nil {
		return nil
	}
	return &cmd
}

func runCmd(cmd *Command) (string, string) {
	timeout := cmd.Timeout
	if timeout <= 0 {
		timeout = 30000
	}

	c := exec.Command("sh", "-c", cmd.Command)
	c.Stdout = nil
	c.Stderr = nil

	var out bytes.Buffer
	c.Stdout = &out
	c.Stderr = &out

	err := c.Start()
	if err != nil {
		return "", err.Error()
	}

	done := make(chan error, 1)
	go func() { done <- c.Wait() }()

	select {
	case err = <-done:
		if err != nil {
			return out.String(), err.Error()
		}
		return out.String(), ""
	case <-time.After(time.Duration(timeout) * time.Millisecond):
		c.Process.Kill()
		<-done
		return out.String(), "command timed out"
	}
}

func sendResult(base, id, cmdID, output, errStr string) {
	r := Result{CmdID: cmdID, Output: output, Error: errStr}
	data, err := json.Marshal(r)
	if err != nil {
		log.Printf("json marshal error: %v", err)
		return
	}
	resp, err := http.Post(base+"/result/"+id, "application/json", bytes.NewReader(data))
	if err != nil {
		log.Printf("sendResult error: %v", err)
		return
	}
	resp.Body.Close()
}
