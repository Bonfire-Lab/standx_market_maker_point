# Mark Price & Spread Analysis

## 概述

本文档记录了对 StandX mark price 和 spread 的研究分析，以及相关优化方向。

## 数据来源

StandX 提供两种获取价格数据的方式：

1. **WebSocket (Market Stream)**
   - Endpoint: `wss://perps.standx.com/ws-stream/v1`
   - Channel: `price`
   - 实时推送，但可能有延迟

2. **REST API**
   - Endpoint: `https://perps.standx.com/api/query_symbol_price`
   - 更准确，但有 rate limit (429)

## 数据结构

### WebSocket 返回格式

```json
{
  "channel": "price",
  "symbol": "BTC-USD",
  "data": {
    "mark_price": "90546.43",
    "index_price": "90520.481",
    "last_price": "90566",
    "mid_price": "90566.0050",
    "spread": ["90566", "90566.01"]  // [bid, ask]
  }
}
```

### REST API 返回格式

```json
{
  "mark_price": "90571.76",
  "index_price": "90567.929",
  "last_price": "90571.76",
  "mid_price": "90572.1050",
  "spread_bid": "90571.69",   // bid (买一价)
  "spread_ask": "90572.52"    // ask (卖一价)
}
```

## Mark Price 计算方式

根据 [StandX 文档](https://docs.standx.com/docs/stand-x-perps-solutions/price-indicators)：

```
Mark Price = median(
  1. Funding-adjusted index (oracle ± funding rate)
  2. Short-term basis (StandX mid vs index 的平均差异)
  3. Latest StandX trade (最新成交价)
)
```

**特点**：
- Mark price 是中位数，天然滞后于极端价格
- 异常情况下会参考 Binance/OKX/Bybit 的 median mark price
- 用于 TP/SL 触发、清算判断、Maker Program 计分

## 关键发现

### 1. WebSocket vs REST API 延迟

对比测试显示 WebSocket 存在延迟：

```
📊 MARK PRICE:
  WS:   90575           ← 旧数据
  REST: 90580.40        ← 新数据
  Diff: +0.60 bp        ← WS 落后
```

**结论**：WebSocket 的 mark price 和 spread 更新比 REST 慢，价格快速波动时差距可达 0.5-1 bp。

### 2. Spread 含义

```
spread = [bid, ask]  // 订单簿买一价、卖一价
```

- `bid`: 买一价（最高买入价）
- `ask`: 卖一价（最低卖出价）
- spread 通常是 0-0.1 bp，流动性好时很小

### 3. Mark Price 与 Spread 的关系

正常情况下：
```
mark - bid: ~0 bp
ask - mark: ~0 bp
✅ Mark price is WITHIN spread
```

异常情况下（价格快速波动）：
```
last - mark: +11.6 bp  ← 巨大差距
```

这发生在市场剧烈波动时，last_price (最新成交) 与 mark_price 差距很大。

### 4. 成交价格机制

根据 [TP/SL 文档](https://docs.standx.com/docs/stand-x-perps-solutions/take-profit-and-stop-loss-orders-tp-sl)：

| 订单类型 | 触发条件 | 成交价格 |
|---------|---------|---------|
| Market Order | - | 订单簿实际价格 |
| Limit Order | - | 限价或更好的价格 |
| TP/SL | mark price | 订单簿实际价格 |

**重要**：Limit Order 可能以比限价更好的价格成交。

## 问题案例分析

### 案例：Sell Order 瞬间成交

```
18:31:15 - 挂 SELL @ $90523.2
18:31:17 - price update: mark=$90392.96, last=$90497.68
          gap ≈ 11.6 bp!
18:31:17 - 判断 "Too far"，取消重下
18:31:17 - 新 SELL @ $90465.3 (用 mark + 20 bp)
18:31:18 - FILLED @ $90490 (比挂单价格更高！)
```

**原因分析**：
1. Mark price 与 last_price 差距 ~11 bp
2. 用 mark price 计算订单位置
3. 但市场在 last_price 附近成交
4. 新单刚下完就被吃掉

## Market Maker Uptime Program 规则

根据 [MM Program 文档](https://docs.standx.com/docs/stand-x-campaigns/market-maker-uptime-program)：

- 订单必须在 **mark price 的 10 bp 范围内**
- 每小时至少 30 分钟 uptime
- 订单价值上限 2 BTC per side
- 奖励 = order size × uptime multiplier

**建议**：放稍微紧一点（buffer），确保持续符合 10 bp 范围。

## 优化方向

### 方案 1：取消重下前查 REST API

**描述**：在判断是否需要取消重下订单时，用 REST API 获取最新价格。

**优点**：
- 直接解决 WS 延迟问题
- 改动小，频率可控

**缺点**：
- 可能触发 rate limit

### 方案 2：检测价差异常

**描述**：当 `|last - mark| > 阈值（如 8 bp）` 时，暂停挂单或调整策略。

**优点**：
- 避免"追涨杀跌"
- 无需额外请求

**缺点**：
- 可能错过 uptime

### 方案 3：用 Spread 验证订单位置

**描述**：
- Sell order 必须 > ask
- Buy order 必须 < bid

**优点**：
- 避免挂在 spread 内侧被立即吃掉
- 无需额外请求

**缺点**：
- 需要解析 spread 数据

### 方案 4：放宽 Cancel 阈值

**描述**：当检测到价差异常时，把 cancel 阈值从 9 bp 放宽到 15 bp。

**优点**：
- 减少频繁重下
- 降低"撞车"概率

**缺点**：
- 可能超出 10 bp 范围，不计分

### 方案 5：定期校准

**描述**：每 10-15 秒用 REST API 校准一次价格。

**优点**：
- 平衡及时性和 rate limit
- 主动发现偏差

**缺点**：
- 增加请求量

## 推荐实现方案

### 阶段 1：无额外请求的优化

1. **解析并存储 spread 数据**
   - 修改 `WSMarkPriceData` 类型，添加 spread 字段
   - 在 `handleMarkPrice` 中解析 spread

2. **用 spread 验证订单位置**
   - 下单前检查：Sell > ask, Buy < bid
   - 如果不满足，调整价格或跳过

3. **检测 last-mark 差距**
   - 当差距 > 8 bp 时，记录警告
   - 可选：暂停挂单直到差距缩小

### 阶段 2：REST API 校准

4. **取消重下前查 REST**
   - 只在需要取消重下时调用
   - 添加缓存（5 秒 TTL）避免重复请求

5. **定期校准**（可选）
   - 每 15 秒查一次 REST
   - 比较 WS 和 REST 的差距
   - 差距大时记录警告

## 测试脚本

项目包含以下测试脚本（位于 `scripts/` 目录）：

- `test-ws-price.ts` - 测试 WebSocket price channel
- `test-rest-price.ts` - 测试 REST API price endpoint
- `test-ws-rest-compare.ts` - 对比 WS 和 REST 数据

运行方式：
```bash
npx tsx scripts/test-ws-price.ts
npx tsx scripts/test-rest-price.ts
npx tsx scripts/test-ws-rest-compare.ts
```

## 参考资料

- [Market Maker Uptime Program](https://docs.standx.com/docs/stand-x-campaigns/market-maker-uptime-program)
- [Price Indicators](https://docs.standx.com/docs/stand-x-perps-solutions/price-indicators)
- [TP/SL Orders](https://docs.standx.com/docs/stand-x-perps-solutions/take-profit-and-stop-loss-orders-tp-sl)
- [Perps WebSocket API](https://docs.standx.com/standx-api/perps-ws)
- [Perps HTTP API - Query Symbol Price](https://docs.standx.com/standx-api/perps-http#query-symbol-price)

## 更新日志

| 日期 | 更新内容 |
|------|---------|
| 2026-01-10 | 初始版本，记录 mark price 分析和优化方向 |
