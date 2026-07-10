export function recommendTargetGuide(config = {}, context = {}) {
  const text = collectGuideText(config, context);
  if (!isSentinelMesh(text)) return null;

  return {
    id: "sentinel-mesh-no-proxy",
    title: "Sentinel Mesh No-Proxy Guide",
    body: [
      "识别依据: 入口为 Spring/Tomcat，出现 entry01、sentinel、LAB_ROUTES、10.92.10/20/30、Tomcat 8.5.77 或 Spring 5.3.17 等证据之一。",
      "适用前提: 只能通过授权入口或已控入口节点观察内网；不要读取本地 docker/history/flags fixture，不要从本机直接扫描 10.92 私网段。",
      "稳定打法总原则: fresh 靶场时一次打稳 entry01；无 proxy 时依赖 webshell/RCE 上的 curl、sh/bash、python/socket 做内网 HTTP/TCP 验证。",
      "entry01 步骤: 利用 Spring4Shell 写唯一文件名 webshell，fileDateFormat 必须设置为日期后缀而非空字符串；验证 webshell 可执行后立即关闭 AccessLogValve enabled=false。",
      "entry01 取证: 立刻执行 id、whoami、hostname、pwd、uname -a、cat /flag.txt、ip addr、ip route、cat /etc/hosts、cat /etc/resolv.conf、env | sort、command -v curl wget nc python3 python bash sh ftp。",
      "污染 webshell 场景: 如果 shell.jsp 已返回 quote symbol expected/500，但偶尔还能执行简单命令，不要继续把主要时间花在写新 JSP；最多尝试 2 次关闭 valve 或找备用文件，然后直接用现有 RCE 做最小内网 HTTP 探测。",
      "Runtime.exec 限制: 已污染的 JSP 常是 Runtime.exec(String)，不会自动经过 shell；不要依赖管道、重定向、&&、复杂引号或 here-doc。优先执行无 shell 元字符的短命令，例如 id、ip route、command -v curl、curl -s http://10.92.20.11:8983/solr/admin/cores。",
      "内网范围: 只从 ip route、LAB_ROUTES、hosts、DNS search domain 推导；Sentinel 常见证据会指向 10.92.20.0/24 和 10.92.30.0/24 经 10.92.10.20。",
      "无 proxy 服务发现: 在 entry01 上用 curl 或 python socket 验证少量固定候选，不要全网扫；优先 10.92.20.10:80、10.92.20.11:8983、10.92.20.20:80、10.92.30.30:5984、10.92.30.40:21、10.92.30.50:9000/9001。",
      "间歇 RCE 的最短推进: 只要 id 或 command -v curl 成功过，就连续尝试这些目标侧 curl：/solr/admin/cores、CouchDB / 和 /_all_dbs、MinIO /minio/health/live 和 /flag/flag.txt；把响应保存后再决定 playbook。",
      "无 proxy 优先级: 先打纯 HTTP/curl 链路的 Solr 和 CouchDB；再用 python socket 或 ftp 命令打 ProFTPD mod_copy；MinIO 先查目标侧 intranet/mail/db/repo 线索再访问 bucket；GitLab ExifTool 需要上传 payload，只有当前 RCE 工具链能稳定生成和提交 multipart 时再做。",
      "Solr: 先 GET /solr/admin/cores 找 core；对 core config API 开启 VelocityResponseWriter 参数；先 id/whoami，再 cat /flag.txt。全程从 entry01 curl 请求内网 URL。",
      "CouchDB: 先 GET /、/_all_dbs、/_utils/；若匿名可用或可创建 admin，再检查 _config 写入链；先 id/whoami，再 cat /flag.txt。避免留下长期后台进程。",
      "ProFTPD: 用 python socket 或 ftp 客户端与 10.92.30.40:21 交互，验证 banner 和匿名；SITE CPFR /flag.txt，SITE CPTO /var/ftp/flag.txt，再 RETR /flag.txt 或 /var/ftp/flag.txt。",
      "MinIO: 先检查 /minio/health/live 和 path-style /flag/flag.txt；如需要凭据，只能使用从目标侧页面、邮件、数据库或仓库中发现的凭据，不要凭空猜。",
      "GitLab: 先确认首页/版本/登录状态；如果需要认证，先从目标侧线索找凭据；ExifTool RCE 先执行 id/whoami，再读 /flag.txt。",
      "失败处理: 如果 webshell 返回 500、RCE 不可用或无法执行 curl/python/sh，立即停止内网 playbook，输出需要靶场重置、callback host、SSH 跳板或可用命令执行通道。",
      "停止条件: 每个节点最多一个 flag；拿到一个节点 flag 后切到下一节点。不要在无可用入口 RCE 时继续套内网 playbook。",
    ],
  };
}

function collectGuideText(config, context) {
  return [
    config.target,
    config.targetHost,
    context.loopPlan?.title,
    ...(context.loopPlan?.goals || []),
    context.whiteboardSummary,
    context.lastOutput,
    ...(context.foundFlags || []),
  ].filter(Boolean).join("\n");
}

function isSentinelMesh(text) {
  return /sentinel|entry01|LAB_ROUTES|10\.92\.(?:10|20|30)\.|Tomcat\/?8\.5\.77|Spring Framework 5\.3\.17|47\.238\.225\.21:18081/i.test(String(text || ""));
}
