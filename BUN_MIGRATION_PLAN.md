# Bun 迁移计划

## 项目现状分析

**当前技术栈：**
- Node.js 运行时
- TypeScript + tsx (开发模式)
- 16 个生产依赖
- 112MB node_modules

**主要依赖项兼容性检查：**

| 依赖 | Bun 兼容性 | 说明 |
|------|-----------|------|
| `@noble/curves` | ✅ 原生 JS | 无问题 |
| `axios` | ✅ 原生 JS | 无问题，可用 Bun 的 fetch 替代 |
| `blessed` | ⚠️ 待测试 | TUI 库，可能有 ncurses 绑定问题 |
| `chalk` | ✅ 原生 JS | 无问题 |
| `convict` | ✅ 原生 JS | 无问题 |
| `decimal.js` | ✅ 原生 JS | 无问题 |
| `dotenv` | ✅ 内置 | Bun 内置支持 |
| `ethers` | ✅ 原生 JS | 无问题 |
| `eventemitter3` | ✅ 原生 JS | 无问题 |
| `jose` | ✅ 原生 JS | 无问题 |
| `node-telegram-bot-api` | ⚠️ 待测试 | 可能依赖 Node 特定 API |
| `uuid` | ✅ 原生 JS | 无问题 |
| `winston` | ⚠️ 待测试 | 可能有 Node 兼容性问题 |
| `winston-daily-rotate-file` | ⚠️ 待测试 | 文件操作可能有问题 |
| `ws` | ✅ 内置 | Bun 内置 WebSocket |

## Bun 优势分析

1. **性能提升**
   - 启动速度：快 4-8x
   - 运行速度：快 10-30%（部分场景）
   - 内存占用：降低约 20-30%

2. **开发体验**
   - 原生 TypeScript，无需 tsx
   - 内置 watch 模式
   - 内置 test runner

3. **部署简化**
   - 单一二进制，无需单独安装 Node.js
   - 更小的 Docker 镜像

## 潜在风险

1. **blessed TUI 兼容性** - 这是最大的风险点
2. **winston 日志库** - 可能需要替换为 Bun.log
3. **生产环境稳定性** - Bun 相对较新

## 迁移步骤

### Stage 1: 本地测试验证
**目标**: 验证所有依赖在 Bun 下可正常运行
**测试**:
- [ ] Bun 安装和版本检查
- [ ] 运行 `bun install` 验证依赖安装
- [ ] 运行 `bun run dev` 测试开发模式
- [ ] 验证 blessed TUI 正常显示
- [ ] 验证 WebSocket 连接
- [ ] 验证日志功能

### Stage 2: 脚本修改
**目标**: 更新 package.json 脚本使用 Bun
**修改**:
```json
"scripts": {
  "dev": "bun --watch src/index.ts",
  "build": "bun build src/index.ts --outdir dist --target bun",
  "start": "bun dist/index.js"
}
```

### Stage 3: 清理依赖
**目标**: 移除 Bun 内置功能的替代依赖
**移除**:
- `tsx` (Bun 原生 TS)
- `dotenv` (Bun 内置)
- `ws` (Bun 内置)

### Stage 4: 生产部署测试
**目标**: 在生产环境验证稳定性
**测试**:
- [ ] PM2 配置更新使用 Bun
- [ ] 长时间运行稳定性测试
- [ ] 内存/CPU 对比

### Stage 5: 性能优化（可选）
**目标**: 利用 Bun 特性优化
**优化点**:
- 用 `Bun.file()` 替代 fs 操作
- 用 `fetch()` 替代 axios
- 用原生 WebSocket 替代 ws 库

## 决策建议

**推荐迁移，如果：**
- ✅ Stage 1 测试全部通过
- ✅ blessed TUI 工作正常
- ✅ 你愿意承担一些调试风险

**暂不迁移，如果：**
- ❌ blessed TUI 有问题
- ❌ 当前性能已经满足需求
- ❌ 优先保证稳定性

## 当前状态

**Status**: Not Started

---

*注：本计划仅供参考，是否迁移取决于 Stage 1 的测试结果*
