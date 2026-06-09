# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# 读取原文件
with open(r'C:\Users\今古济世\.qclaw\workspace\health-app\backend\main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 定义要插入的函数
tongue_func = '''

# ==================== Tongue Image Analysis ====================

async def analyze_tongue_image(base64_image: str, knowledge_content: list = None) -> dict:
    """
    调用 AI API 分析舌象图片
    返回: {"tongue_analysis": "分析结果"}
    """
    try:
        # 构建系统提示词
        system_prompt = """你是专业的中医舌象辨析专家。请仔细分析用户上传的舌象图片，从以下几个方面进行辨析：

1. **舌质（舌色）**：淡白、淡红、红、绛红、青紫等
2. **舌苔**：颜色（白、黄、灰、黑）、厚薄（薄、厚、少苔、无苔）、润燥（润、燥、滑、糙）
3. **舌形**：老嫩、胖瘦、齿痕、裂纹、芒刺
4. **舌态**：痿软、强硬、歪斜、颤动、吐弄
5. **舌下络脉**：颜色、形态、曲张情况

请按照以下格式输出：
◆ 舌象辨析结果 ◆
【舌质】...(颜色、光泽)
【舌苔】...(颜色、厚薄、润燥)
【舌形】...(形态、特殊标记)
【舌态】...(动态特征)
【舌下络脉】...(若可见)
【综合判断】...(中医病机分析)

注意：
- 描述要客观、专业
- 避免主观臆断
- 如果图片不清晰，请说明
- 结合中医理论进行分析"""

        # 如果有知识库内容，追加到提示词
        if knowledge_content:
            system_prompt += "\\n\\n【参考资料】\\n" + "\\n".join(knowledge_content)

        # 构建用户消息（包含图片）
        if "base64," in base64_image:
            image_url = base64_image
        else:
            image_url = f"data:image/jpeg;base64,{base64_image}"

        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_url}},
                    {"type": "text", "text": "请分析这个舌象图片，给出专业的中医舌象辨析结果。"}
                ]
            }
        ]

        # 调用 Agnes AI API
        AGNES_API_KEY = os.getenv("AGNES_API_KEY")
        AGNES_API_URL = os.getenv("AGNES_API_URL", "https://apihub.agnes-ai.com/v1/chat/completions")
        AGNES_MODEL = os.getenv("AGNES_MODEL", "agnes-2.0-flash")

        if not AGNES_API_KEY:
            raise ValueError("AGNES_API_KEY 未配置，请在 .env 文件中设置")

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {AGNES_API_KEY}",
        }

        payload = {
            "model": AGNES_MODEL,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": 2000,
        }

        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                AGNES_API_URL,
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            result = response.json()

        # 提取 AI 回复
        if "choices" in result and len(result["choices"]) > 0:
            tongue_analysis = result["choices"][0]["message"]["content"]
            return {"tongue_analysis": tongue_analysis}
        else:
            raise ValueError(f"AI API 返回格式异常: {result}")

    except Exception as e:
        print(f"舌象分析失败: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        raise


'''

# 在注释行之后插入函数
marker = '# ==================== AI Consultation APIs ====================\n'
if marker in content:
    # 在标记后插入函数
    new_content = content.replace(marker, marker + tongue_func, 1)
    
    # 写回文件
    with open(r'C:\Users\今古济世\.qclaw\workspace\health-app\backend\main.py', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("✅ 成功插入 analyze_tongue_image() 函数")
else:
    print("❌ 未找到标记行，无法插入")
    sys.exit(1)
