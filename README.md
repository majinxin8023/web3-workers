# Web3 Workers

一个基于 Cloudflare Workers 的 Web3 应用开发模板，提供安全的用户管理和区块链签名验证功能。

## 🚀 特性

- **无服务器架构**: 基于 Cloudflare Workers，全球边缘计算
- **Web3 签名验证**: 使用 ethers.js 验证以太坊签名
- **用户会话管理**: 安全的会话验证和用户管理
- **防重放攻击**: 时间戳和随机数验证机制
- **D1 数据库集成**: 使用 Cloudflare D1 进行数据存储
- **CORS 支持**: 完整的跨域资源共享配置
- **多环境部署**: 支持开发、测试、生产环境

## 📦 项目结构

```
web3-workers/
├── src/
│   └── index.js          # 主要的Worker代码
├── schema.sql            # 数据库表结构定义
├── package.json          # 项目依赖和脚本
├── wrangler.toml         # Cloudflare Workers配置
├── .gitignore           # Git忽略文件
└── README.md            # 项目说明文档
```

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone <your-repo-url>
cd web3-workers
```

### 2. 安装依赖

```bash
npm install
```

### 3. 本地开发

```bash
npm run dev
```

这将启动本地开发服务器，通常运行在 `http://localhost:8787`

### 4. 测试 API

访问 `http://localhost:8787` 查看 API 信息，或使用以下命令测试：

```bash
curl http://localhost:8787
```

### 5. 设置数据库

在部署前，需要先创建 D1 数据库：

```bash
# 创建 D1 数据库
npx wrangler d1 create web3-workers-db

# 应用数据库表结构
npx wrangler d1 execute web3-workers-db --file=./schema.sql

# 更新 wrangler.toml 中的 database_id
```

### 6. 部署到 Cloudflare

首先需要配置 Cloudflare 账户：

```bash
# 登录Cloudflare账户
npx wrangler login

# 部署到生产环境
npm run deploy
```

## 📡 API 端点

### 基础信息

- **GET** `/` - 获取 API 信息和可用端点列表

### 用户管理

- **POST** `/api/update-username` - 更新用户用户名（需要签名验证）

#### 更新用户名示例

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/update-username" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -d '{
    "walletAddress": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
    "newUsername": "newusername",
    "signature": "0x...",
    "message": "Update username to newusername",
    "timestamp": 1703123456789,
    "nonce": "unique-nonce-123"
  }'
```

### 请求参数说明

| 参数          | 类型   | 必需 | 说明                     |
| ------------- | ------ | ---- | ------------------------ |
| walletAddress | string | 是   | 用户钱包地址             |
| newUsername   | string | 是   | 新的用户名               |
| signature     | string | 是   | 以太坊签名               |
| message       | string | 是   | 签名的原始消息           |
| timestamp     | number | 是   | 请求时间戳（防重放攻击） |
| nonce         | string | 是   | 唯一随机数（防重复提交） |

## 🔧 配置

### D1 数据库配置

在 `wrangler.toml` 中配置 D1 数据库：

```toml
[[d1_databases]]
binding = "DB"
database_name = "web3-workers-db"
database_id = "a99197bc-d7b8-4730-ab0a-ff4d34156a01"  # 实际的数据库ID
```

### 环境变量

在 `wrangler.toml` 中配置环境变量：

```toml
[vars]
ENVIRONMENT = "development"
```

### CORS 配置

在 `src/index.js` 中修改 CORS 头部来配置允许的域名：

```javascript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // 生产环境建议指定具体域名
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
};
```

## 🔐 安全特性

### 签名验证

项目使用 ethers.js 进行以太坊签名验证，确保请求的真实性：

```javascript
function verifyEthereumSignature(message, signature, expectedAddress) {
  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);
    return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
  } catch (error) {
    return false;
  }
}
```

### 防重放攻击

- **时间戳验证**: 请求必须在 5 分钟内有效
- **随机数验证**: 每个请求必须包含唯一的 nonce
- **会话验证**: 需要有效的用户会话令牌

### 数据库安全

- 使用参数化查询防止 SQL 注入
- 事务处理确保数据一致性
- 操作记录用于审计追踪

## 🚀 部署到不同环境

### 开发环境

```bash
npm run dev
```

### 预发布环境

```bash
npx wrangler deploy --env staging
```

### 生产环境

```bash
npx wrangler deploy --env production
```

## 📚 学习资源

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 数据库文档](https://developers.cloudflare.com/d1/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [Ethers.js 文档](https://docs.ethers.io/)
- [Web3 签名验证最佳实践](https://ethereum.org/developers/docs/signatures/)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目！

## 📄 许可证

MIT License - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🆘 故障排除

### 常见问题

#### 1. D1 数据库配置错误

**错误信息**: `You must use a real database in the database_id configuration`

**解决方案**:

```bash
# 1. 查看现有数据库
npx wrangler d1 list

# 2. 更新 wrangler.toml 中的 database_id
# 将 "your-database-id" 替换为实际的数据库 ID

# 3. 应用数据库表结构
npx wrangler d1 execute web3-workers-db --file=./schema.sql
```

#### 2. 端口被占用

**错误信息**: `Address already in use`

**解决方案**:

```bash
# 使用不同的端口
npx wrangler dev --local --port 8788

# 或者杀死占用端口的进程
pkill -f wrangler
```

#### 3. 依赖安装问题

**解决方案**:

```bash
# 清理并重新安装
rm -rf node_modules package-lock.json
npm install
```

## 🆘 支持

如果你遇到任何问题，请：

1. 查看 [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
2. 查看 [Cloudflare D1 数据库文档](https://developers.cloudflare.com/d1/)
3. 在 GitHub 上创建 Issue
4. 联系项目维护者

---

**Happy Coding! 🎉**
