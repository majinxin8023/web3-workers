// 导入必要的库
import { ethers } from "ethers";

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
    const { walletAddress, newUsername, signature, message, timestamp, nonce } =
      data;

    // 1. 基础验证
    if (!walletAddress || !newUsername || !signature || !message) {
      return createCorsResponse(
        {
          success: false,
          error: "缺少必要参数",
        },
        400
      );
    }

    // 2. 会话验证
    const authHeader = request.headers.get("Authorization");
    const sessionToken = authHeader?.replace("Bearer ", "");
    const session = await verifySession(env.DB, sessionToken, walletAddress);

    if (!session) {
      return createCorsResponse(
        {
          success: false,
          error: "会话无效或已过期",
        },
        401
      );
    }

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

    // 4. 时间戳验证（防止重放攻击）
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

    // 5. 随机数验证（防止重复提交）
    const existingNonce = await env.DB.prepare(
      `
            SELECT id FROM user_operation_signatures 
            WHERE nonce = ? AND wallet_address = ?
        `
    )
      .bind(nonce, walletAddress)
      .first();

    if (existingNonce) {
      return createCorsResponse(
        {
          success: false,
          error: "请勿重复提交",
        },
        400
      );
    }

    // 6. 记录操作签名
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
        "pending"
      )
      .run();

    // 7. 执行用户名更新
    const updateResult = await env.DB.prepare(
      `
            UPDATE users 
            SET username = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE wallet_address = ?
        `
    )
      .bind(newUsername, walletAddress)
      .run();

    if (updateResult.changes > 0) {
      // 8. 更新操作状态为成功
      await env.DB.prepare(
        `
                UPDATE user_operation_signatures 
                SET status = 'success' 
                WHERE nonce = ? AND wallet_address = ?
            `
      )
        .bind(nonce, walletAddress)
        .run();

      return createCorsResponse({
        success: true,
        message: "用户名修改成功",
        newUsername: newUsername,
      });
    } else {
      throw new Error("数据库更新失败");
    }
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
            endpoints: ["POST /api/update-username - 更新用户名"],
          });

        case "/api/update-username":
          if (method === "POST") {
            return await handleUpdateUsername(request, env);
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
