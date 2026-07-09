const SKILL_RULES = [
  {
    name: "recon-and-methodology",
    reason: "信息收集、资产建模或攻击面梳理阶段",
    pattern: /信息收集|攻击面|目录|指纹|资产|服务|端口|nmap|gobuster|dirsearch|ffuf|whatweb|crawl/i,
  },
  {
    name: "sqli-sql-injection",
    reason: "发现数据库、登录、参数、报错或 SQL 注入线索",
    pattern: /sql|mysql|mariadb|postgres|sqlite|database|数据库|注入|union|order by|login|where|select/i,
  },
  {
    name: "xss-cross-site-scripting",
    reason: "发现页面参数、脚本注入或 XSS 线索",
    pattern: /xss|script|onerror|onload|dom|反射|存储型|跨站/i,
  },
  {
    name: "path-traversal-lfi",
    reason: "发现路径穿越、本地文件读取或敏感文件读取线索",
    pattern: /path traversal|lfi|file read|文件读取|目录穿越|任意文件|passwd|proc\/self|download|include/i,
  },
  {
    name: "cmdi-command-injection",
    reason: "发现命令执行、RCE、框架漏洞或系统命令回显线索",
    pattern: /rce|命令执行|command injection|cmdi|exec|shell|反弹|whoami|id|thinkphp|struts|ognl|spring|solr/i,
  },
  {
    name: "api-recon-and-docs",
    reason: "发现 API、接口文档、JSON 端点或前后端接口线索",
    pattern: /api|swagger|openapi|graphql|json|接口|endpoint|rest/i,
  },
  {
    name: "api-auth-and-jwt-abuse",
    reason: "发现 JWT、Token、认证头或会话令牌线索",
    pattern: /jwt|bearer|token|authorization|cookie|session|认证|鉴权/i,
  },
  {
    name: "authbypass-authentication-flaws",
    reason: "发现登录、弱口令、认证绕过或权限校验线索",
    pattern: /login|登录|password|passwd|admin|auth|认证|鉴权|绕过|弱口令|credential|凭据/i,
  },
  {
    name: "unauthorized-access-common-services",
    reason: "发现 Redis、CouchDB、MinIO、Docker、Elasticsearch 等常见未授权服务",
    pattern: /redis|couchdb|minio|s3|elasticsearch|mongo|mongodb|memcached|docker api|未授权|anonymous|bucket/i,
  },
  {
    name: "tunneling-and-pivoting",
    reason: "进入内网、跳板、隧道或横向移动阶段",
    pattern: /横向|内网|pivot|tunnel|proxy|jump|bastion|ssh -L|ssh -D|端口转发|隧道|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.|192\.168\./i,
  },
  {
    name: "linux-privilege-escalation",
    reason: "获得 shell、命令执行或 Linux 主机访问后需要权限提升检查",
    pattern: /shell|www-data|root|sudo|suid|cron|capabilities|linux|提权|权限扩展|whoami|id|uname/i,
  },
  {
    name: "reverse-shell-techniques",
    reason: "需要建立回连 shell 或稳定命令执行通道",
    pattern: /reverse shell|反弹 shell|回连|nc .* -e|bash -i|mkfifo|webshell/i,
  },
];

export function recommendSkills(context = {}) {
  const text = collectContextText(context);
  const recommendations = [];
  const seen = new Set();

  for (const rule of SKILL_RULES) {
    if (!rule.pattern.test(text) || seen.has(rule.name)) continue;
    seen.add(rule.name);
    recommendations.push({
      name: rule.name,
      reason: rule.reason,
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      name: "recon-and-methodology",
      reason: "未命中特定漏洞类型，默认使用通用侦察方法保持流程完整",
    });
  }

  return recommendations.slice(0, 5);
}

function collectContextText(context) {
  const parts = [
    context.loopPlan?.title,
    ...(context.loopPlan?.goals || []),
    context.whiteboardSummary,
    context.lastOutput,
  ];

  for (const iter of context.iterations || []) {
    parts.push(
      iter.summary,
      iter.position,
      ...(iter.hosts || []),
      ...(iter.services || []).map((svc) => `${svc.host || ""}:${svc.port || ""} ${svc.name || ""}`),
      ...(iter.actions || []),
      ...(iter.nextSteps || []),
      ...(iter.intel || []),
      ...(iter.problems || []).flatMap((p) => [p.symptom, p.cause, p.resolution]),
      ...(iter.toolCalls || []).flatMap((c) => [c.tool, c.command, c.purpose, c.result, c.impact]),
    );
  }

  return parts.filter(Boolean).join("\n");
}
