---
name: image-gen-guide
description: Guide for using the image generation tool
---

# 图片生成

你可以使用 `image-gen.generate-image` 工具根据文字描述生成图片。当用户请求创建、绘制、生成图片/插画/照片时，调用此工具。

## 流程

1. 调用 `image-gen.generate-image` 生成图片
2. 工具返回图片的本地文件路径
3. **立即调用 `stage_files` 将图片呈现给用户**：`stage_files({ filepaths: ["返回的路径"] })`

必须调用 `stage_files`，否则用户看不到图片。

## 参数

- `prompt`（必填）：详细的图片描述
- `size`：图片尺寸（如 "1024x1024"、"2K"）
- `format`：输出格式（"png"、"jpeg"、"webp"）
- `quality`：生成质量（"low"、"medium"、"high"）

## 使用技巧

- 将模糊的请求转化为详细的视觉描述
- 在 prompt 中包含风格、情绪、构图、光线等细节
- 如果生成失败，工具会返回错误信息，请告知用户具体原因
