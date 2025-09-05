// 导入必要的库
import { ethers } from "ethers";
import { SignJWT } from "jose";

// JWT配置
const JWT_SECRET = "your-super-secret-jwt-key-change-this-in-production";
const JWT_EXPIRES_IN = "24h"; // Token有效期24小时

// CORS头部配置
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
};

// 创建带CORS头部的响应
function createCorsResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

// Cloudflare Worker 中的处理逻辑
export async function handleUpdateUsername(request, env) {
  try {
    const data = await request.json();
    const {
      walletAddress,
      newUsername,
      signature,
      message,
      timestamp,
      nonce,
      jwtToken,
    } = data;

    // 1. 基础验证
    if (!walletAddress || !newUsername) {
      return createCorsResponse(
        {
          success: false,
          error: "缺少必要参数",
        },
        400
      );
    }

    // 2. 智能认证：优先使用JWT token验证
    if (jwtToken && jwtToken !== "cached_signature") {
      console.log("🔐 使用JWT token验证");

      try {
        const { payload } = await jwtVerify(
          jwtToken,
          new TextEncoder().encode(JWT_SECRET)
        );

        // 验证token中的钱包地址
        if (
          payload.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()
        ) {
          return createCorsResponse(
            {
              success: false,
              error: "Token中的钱包地址不匹配",
            },
            401
          );
        }

        // 验证token是否过期
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) {
          return createCorsResponse(
            {
              success: false,
              error: "Token已过期",
            },
            401
          );
        }

        console.log("✅ JWT token验证成功");
        // JWT验证成功，跳过签名验证
      } catch (jwtError) {
        console.error("❌ JWT token验证失败:", jwtError);
        return createCorsResponse(
          {
            success: false,
            error: "Token验证失败",
          },
          401
        );
      }
    } else if (signature && message) {
      console.log("🔐 使用签名验证");

      // 3. 签名验证
      const isValidSignature = verifyEthereumSignature(
        message,
        signature,
        walletAddress
      );
      if (!isValidSignature) {
        return createCorsResponse(
          {
            success: false,
            error: "签名验证失败",
          },
          400
        );
      }
    } else {
      return createCorsResponse(
        {
          success: false,
          error: "缺少认证信息（JWT token或签名）",
        },
        400
      );
    }

    // 4. 时间戳和随机数验证（仅在使用签名验证时）
    if (signature && message) {
      const now = Date.now();
      const timeDiff = Math.abs(now - timestamp);
      if (timeDiff > 5 * 60 * 1000) {
        // 5分钟有效期
        return createCorsResponse(
          {
            success: false,
            error: "操作已过期，请重新操作",
          },
          400
        );
      }

      // 随机数验证（防止重放攻击）
      const existingNonce = await env.DB.prepare(
        `SELECT id FROM user_operation_signatures WHERE nonce = ? AND wallet_address = ?`
      )
        .bind(nonce, walletAddress)
        .first();

      if (existingNonce) {
        return createCorsResponse(
          { success: false, error: "请勿重复提交" },
          400
        );
      }
    }

    // 6. 首先确保用户存在（在外键约束之前）
    const existingUser = await env.DB.prepare(
      `SELECT id FROM users WHERE wallet_address = ?`
    )
      .bind(walletAddress)
      .first();

    if (!existingUser) {
      // 创建新用户
      await env.DB.prepare(
        `
        INSERT INTO users (wallet_address, username) VALUES (?, ?)
      `
      )
        .bind(walletAddress, newUsername)
        .run();
    } else {
      // 更新现有用户
      await env.DB.prepare(
        `
        UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP
        WHERE wallet_address = ?
      `
      )
        .bind(newUsername, walletAddress)
        .run();
    }

    // 7. 记录操作签名（现在用户已存在，外键约束满足）
    if (signature && message) {
      // 使用签名验证时的记录方式
      await env.DB.prepare(
        `
        INSERT INTO user_operation_signatures (
          wallet_address, operation_type, operation_data,
          signature, message, nonce, timestamp, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
        .bind(
          walletAddress,
          "update_username",
          JSON.stringify({ newUsername }),
          signature,
          message,
          nonce,
          timestamp,
          "completed"
        )
        .run();
    } else {
      // 使用JWT验证时的记录方式
      await env.DB.prepare(
        `
        INSERT INTO user_operation_signatures (
          wallet_address, operation_type, operation_data,
          signature, message, nonce, timestamp, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
        .bind(
          walletAddress,
          "update_username",
          JSON.stringify({ newUsername }),
          "jwt_authenticated",
          "JWT token authentication",
          `jwt_${Date.now()}`,
          Date.now(),
          "completed"
        )
        .run();
    }

    // 模拟成功响应
    console.log("✅ 签名验证通过，用户名更新成功");
    console.log("钱包地址:", walletAddress);
    console.log("新用户名:", newUsername);
    console.log("签名:", signature);
    console.log("消息:", message);

    return createCorsResponse({
      success: true,
      message: "用户名修改成功（签名验证通过）",
      newUsername: newUsername,
      walletAddress: walletAddress,
      signature: signature,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("更新用户名失败:", error);
    return createCorsResponse(
      {
        success: false,
        error: error.message || "服务器内部错误",
      },
      500
    );
  }
}

// 验证会话
async function verifySession(db, sessionToken, walletAddress) {
  try {
    if (!sessionToken || !walletAddress) {
      return null;
    }

    const session = await db
      .prepare(
        `SELECT * FROM user_sessions 
       WHERE session_token = ? AND wallet_address = ? AND expires_at > CURRENT_TIMESTAMP`
      )
      .bind(sessionToken, walletAddress)
      .first();

    return session;
  } catch (error) {
    console.error("会话验证错误:", error);
    return null;
  }
}

// 验证以太坊签名
function verifyEthereumSignature(message, signature, expectedAddress) {
  try {
    // 使用 ethers.js 验证签名
    const recoveredAddress = ethers.verifyMessage(message, signature);
    return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
  } catch (error) {
    console.error("签名验证错误:", error);
    return false;
  }
}

// 生成JWT Token
async function generateJWTToken(walletAddress, username = null) {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);

    const token = await new SignJWT({
      walletAddress,
      username,
      type: "auth",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(JWT_EXPIRES_IN)
      .setIssuer("web3-workers")
      .setAudience("web3-course")
      .sign(secret);

    return token;
  } catch (error) {
    console.error("生成JWT Token失败:", error);
    throw new Error("Token生成失败");
  }
}

// 处理用户授权（生成JWT Token）
export async function handleAuth(request, env) {
  try {
    const data = await request.json();
    const { walletAddress, signature, message, timestamp, nonce } = data;

    // 1. 基础验证
    if (!walletAddress || !signature || !message) {
      return createCorsResponse(
        {
          success: false,
          error: "缺少必要参数",
        },
        400
      );
    }

    // 2. 签名验证
    const isValidSignature = verifyEthereumSignature(
      message,
      signature,
      walletAddress
    );
    if (!isValidSignature) {
      return createCorsResponse(
        {
          success: false,
          error: "签名验证失败",
        },
        400
      );
    }

    // 3. 时间戳验证（防止重放攻击）
    const now = Date.now();
    const timeDiff = Math.abs(now - timestamp);
    if (timeDiff > 5 * 60 * 1000) {
      // 5分钟有效期
      return createCorsResponse(
        {
          success: false,
          error: "操作已过期，请重新操作",
        },
        400
      );
    }

    // 4. 随机数验证（防止重放攻击）
    const existingNonce = await env.DB.prepare(
      `SELECT id FROM user_operation_signatures WHERE nonce = ? AND wallet_address = ?`
    )
      .bind(nonce, walletAddress)
      .first();

    if (existingNonce) {
      return createCorsResponse({ success: false, error: "请勿重复提交" }, 400);
    }

    // 5. 获取用户信息
    const user = await env.DB.prepare(
      `SELECT * FROM users WHERE wallet_address = ?`
    )
      .bind(walletAddress)
      .first();

    // 6. 生成JWT Token
    const token = await generateJWTToken(walletAddress, user?.username || null);

    // 7. 记录授权操作
    await env.DB.prepare(
      `
      INSERT INTO user_operation_signatures (
        wallet_address, operation_type, operation_data,
        signature, message, nonce, timestamp, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
      .bind(
        walletAddress,
        "auth",
        JSON.stringify({ action: "login" }),
        signature,
        message,
        nonce,
        timestamp,
        "completed"
      )
      .run();

    // 8. 生成会话记录（可选）
    const sessionToken = `session_${Date.now()}_${Math.random()
      .toString(36)
      .substring(7)}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24小时后过期

    await env.DB.prepare(
      `
      INSERT INTO user_sessions (wallet_address, session_token, expires_at)
      VALUES (?, ?, ?)
    `
    )
      .bind(walletAddress, sessionToken, expiresAt.toISOString())
      .run();

    console.log("✅ 用户授权成功，Token已生成");
    console.log("钱包地址:", walletAddress);
    console.log("用户名:", user?.username || "未设置");

    return createCorsResponse({
      success: true,
      message: "授权成功",
      data: {
        token,
        sessionToken,
        user: {
          walletAddress,
          username: user?.username || null,
          isNewUser: !user,
        },
        expiresAt: expiresAt.toISOString(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("用户授权失败:", error);
    return createCorsResponse(
      {
        success: false,
        error: error.message || "服务器内部错误",
      },
      500
    );
  }
}

// 获取用户信息
export async function handleGetUser(request, env) {
  try {
    const url = new URL(request.url);
    const walletAddress = url.searchParams.get("walletAddress");

    if (!walletAddress) {
      return createCorsResponse(
        { success: false, error: "缺少钱包地址参数" },
        400
      );
    }

    // 查询用户信息
    const user = await env.DB.prepare(
      `SELECT * FROM users WHERE wallet_address = ?`
    )
      .bind(walletAddress)
      .first();

    if (!user) {
      return createCorsResponse({ success: false, error: "用户不存在" }, 404);
    }

    // 查询用户最近的操作记录
    const operations = await env.DB.prepare(
      `SELECT * FROM user_operation_signatures 
       WHERE wallet_address = ? 
       ORDER BY created_at DESC 
       LIMIT 10`
    )
      .bind(walletAddress)
      .all();

    return createCorsResponse({
      success: true,
      data: {
        user: {
          id: user.id,
          walletAddress: user.wallet_address,
          username: user.username,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        },
        recentOperations: operations.results || [],
      },
    });
  } catch (error) {
    console.error("获取用户信息失败:", error);
    return createCorsResponse(
      { success: false, error: error.message || "服务器内部错误" },
      500
    );
  }
}

// 主要的请求处理器
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 处理CORS
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Max-Age": "86400",
    };

    if (method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    try {
      // 路由处理
      switch (path) {
        case "/":
          return createCorsResponse({
            message: "Web3 Workers API",
            version: "1.0.0",
            endpoints: [
              "POST /api/auth - 用户授权（生成JWT Token）",
              "POST /api/update-username - 更新用户名",
              "GET /api/user?walletAddress=0x... - 获取用户信息",
            ],
          });

        case "/api/auth":
          if (method === "POST") {
            return await handleAuth(request, env);
          } else {
            return createCorsResponse({ error: "Method not allowed" }, 405);
          }

        case "/api/update-username":
          if (method === "POST") {
            return await handleUpdateUsername(request, env);
          } else {
            return createCorsResponse({ error: "Method not allowed" }, 405);
          }

        case "/api/user":
          if (method === "GET") {
            return await handleGetUser(request, env);
          } else {
            return createCorsResponse({ error: "Method not allowed" }, 405);
          }

        default:
          return createCorsResponse({ error: "Not Found" }, 404);
      }
    } catch (error) {
      console.error("Request handling error:", error);
      return createCorsResponse(
        {
          error: "Internal Server Error",
          message: error.message,
        },
        500
      );
    }
  },
};
