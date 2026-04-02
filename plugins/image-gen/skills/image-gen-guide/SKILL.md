---
name: image-gen-guide
description: MUST read before calling image-gen_generate-image or image-gen_generate-video — contains prompt rules and non-blocking workflow
---

# 图片 / 视频生成

使用 `image-gen_generate-image` 和 `image-gen_generate-video` 工具生成媒体内容。

## 非阻塞工作流

生成是异步的。提交后工具立即返回一张卡片，你**不需要等待结果**，也**不需要调用 stage_files**。

1. 按下方规范编写 prompt
2. 调用工具，传入 prompt 和参数
3. **告诉用户图片/视频正在生成，完成后会自动显示在卡片中**
4. **继续对话**，不要等待
5. 当你收到 `<hana-background-result>` 通知时，自然地告知用户结果

## generate-image 参数

- `prompt`（必填）：图片描述（中英文均可，建议英文以获得更好效果）
- `count`：并发生成张数（1-4），用户说"多来几张"时用
- `image`：参考图路径（图生图）
- `ratio`：长宽比（1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9）
- `resolution`：分辨率（2k, 4k）
- `quality`：画质（low, medium, high）
- `provider`：指定 provider（可选，默认自动选择）

## generate-video 参数

- `prompt`（必填）：视频描述
- `image`：参考图路径（图生视频）
- `duration`：时长（秒）
- `ratio`：长宽比
- `provider`：指定 provider（可选）

## Prompt 编写规范

**结构顺序**（前面的词权重更高）：

```
主体（who/what）→ 动作/状态 → 环境/背景 → 光线/氛围 → 画风/媒介
```

**具体化规则**：
- 用户说"猫" → 补充品种、毛色、姿态（如 "a fluffy gray cat curled up on a windowsill"）
- 用户说"风景" → 补充季节、时间、天气（如 "autumn mountain valley at golden hour"）
- 避免抽象词（"美丽的"），用具体视觉描述替代
- 不写否定句，图片模型不理解否定

**长度**：50-150 个英文词，逗号分隔。

**默认画风**：用户没指定画风时，在 prompt 末尾附加：

```
modern Japanese illustration style, soft cel-shaded, clean linework, muted warm color palette with cream and indigo tones, elegant and serene atmosphere, anime-influenced but mature aesthetic
```

用户明确指定了风格（如"油画"、"赛博朋克"、"写实"）时不附加。

## 图生图

当用户消息中包含 `[attached_image: /path/to/file]` 标记，且要求修改/换场景/变风格，传入 `image` 参数。

## 注意

- 生成消耗 provider 额度，大批量前建议提醒用户
- 不同 provider 支持的参数不同，工具会自动处理
- 视频生成通常比图片慢（可能几十秒到几分钟），但同样不阻塞
