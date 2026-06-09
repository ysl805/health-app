import os
import json
import httpx
import asyncio
from typing import List, Optional, AsyncGenerator

# Agnes AI API configuration
# 硬编码正确 URL，避免 .env 加载问题
AGNES_API_URL = "https://apihub.agnes-ai.com/v1/chat/completions"
AGNES_API_KEY = os.environ.get("AGNES_API_KEY", "")

# 调试：打印加载的 URL
print(f"[ai_service] 加载的 AGNES_API_URL: {AGNES_API_URL}", flush=True)


def build_tcm_system_prompt() -> str:
    from datetime import datetime
    now = datetime.now().strftime("%Y年%m月%d日 %H:%M")
    return f"""你是三心董元品牌的中医AI助手，精通舌象辨析和中医辨证。

当前时间：{now}

回复原则：
1. 如有舌象图片，必须先进行舌象辨析，详细分析舌象
2. 结合用户描述的症状与舌象结果，进行综合辨证
3. 最后给出个体化养生方案
4. 使用中医术语，同时用通俗语言解释
5. 排版要求：
   - 禁止使用任何符号：# * - ◆ 【】 ※ ▶ 等
   - 标题单独一行，不加任何符号
   - 各板块之间用长横线 —— 分隔
   - 重点内容直接写，不加符号修饰

回复格式——严格按以下结构回复：

舌象辨析
（如有舌象图片，逐一分析舌质、舌苔、舌形、舌底络脉等）

——

综合辨证
（结合舌象与症状，给出明确的辨证结论：如阴虚火旺、脾虚湿盛等）

——

养生方案

膏方调理
必须分三个阶段推荐：
1. 第一阶段（当前急性期，约1-2周）：对症缓解为主，说明阶段目标，推荐一款膏方并详细解释为何适用。
2. 第二阶段（症状缓解后，约2-4周）：转入调理，说明阶段目标，推荐一款膏方并详细解释为何适用。
3. 第三阶段（固本培元，约2-4周）：巩固体质，说明阶段目标，推荐一款膏方并详细解释为何适用。

饮食调养
具体食材、食疗方

起居调摄
作息、环境建议

运动导引
适合的运动方式

情志调养
情绪调节建议

穴位按摩
推荐穴位及按摩方法

季节养生
当季养生要点

如无舌象图片，跳过舌象辨析，直接从综合辨证开始。"""


def build_knowledge_context(knowledge_content: List[str]) -> str:
    if not knowledge_content:
        return ""
    combined = "\n\n---\n\n".join(knowledge_content)
    return f"\n\n以下是从知识库中检索到的相关资料，请结合这些资料进行回答：\n\n{combined}"


async def call_agnes_ai(
    messages: List[dict],
    knowledge_content: Optional[List[str]] = None,
    has_tongue_image: bool = False,
    custom_prompt: str = "",
    negative_prompt: str = "",
) -> dict:
    """Call Agnes AI API for consultation (non-streaming)"""
    system_content = build_tcm_system_prompt()
    if custom_prompt:
        # Prepend custom persona before default format rules
        system_content = f"【自定义人设与回复规则】\n{custom_prompt}\n\n{system_content}"
    if negative_prompt:
        system_content += f"\n\n【禁止回复内容】以下内容严禁在回复中出现，必须完全回避：\n{negative_prompt}"

    if knowledge_content:
        system_content += build_knowledge_context(knowledge_content)

    if has_tongue_image:
        system_content += "\n\n用户已上传舌象图片，请重点进行舌象辨析。"

    full_messages = [{"role": "system", "content": system_content}] + messages

    headers = {
        "Authorization": f"Bearer {AGNES_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": "agnes-2.0-flash",
        "messages": full_messages,
        "temperature": 0.7,
        "max_tokens": 4096,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(AGNES_API_URL, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    answer = data["choices"][0]["message"]["content"]

    # Parse structured response
    result = {
        "answer": answer,
        "tongue_analysis": "",
        "syndrome_analysis": "",
        "symptoms": [],
    }

    # Try to extract sections from the answer
    if "舌象" in answer or "舌诊" in answer:
        result["tongue_analysis"] = answer
    if "辨证" in answer:
        result["syndrome_analysis"] = answer

    return result


async def stream_agnes_ai(
    messages: List[dict],
    knowledge_content: Optional[List[str]] = None,
    has_tongue_image: bool = False,
    custom_prompt: str = "",
    negative_prompt: str = "",
) -> AsyncGenerator[str, None]:
    """Stream Agnes AI API response, yielding content chunks"""
    system_content = build_tcm_system_prompt()
    if custom_prompt:
        system_content = f"【自定义人设与回复规则】\n{custom_prompt}\n\n{system_content}"
    if negative_prompt:
        system_content += f"\n\n【禁止回复内容】以下内容严禁在回复中出现，必须完全回避：\n{negative_prompt}"

    if knowledge_content:
        system_content += build_knowledge_context(knowledge_content)

    if has_tongue_image:
        system_content += "\n\n用户已上传舌象图片，请重点进行舌象辨析。"

    full_messages = [{"role": "system", "content": system_content}] + messages

    headers = {
        "Authorization": f"Bearer {AGNES_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": "agnes-2.0-flash",
        "messages": full_messages,
        "temperature": 0.7,
        "max_tokens": 4096,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", AGNES_API_URL, json=payload, headers=headers) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content
                except json.JSONDecodeError:
                    continue


async def analyze_tongue_image(image_base64: str, knowledge_content: Optional[List[str]] = None) -> dict:
    """Analyze tongue image using Agnes AI vision capability"""
    system_content = build_tcm_system_prompt() + "\n\n用户上传了舌象图片，请务必先进行「舌象辨析」，再结合问诊症状进行「综合辨证」，最后给出「养生方案」。"

    if knowledge_content:
        system_content += build_knowledge_context(knowledge_content)

    messages = [
        {"role": "system", "content": system_content},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请分析我的舌象，进行舌象辨析"},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}},
            ],
        },
    ]

    headers = {
        "Authorization": f"Bearer {AGNES_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": "agnes-2.0-flash",
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 4096,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(AGNES_API_URL, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    return {
        "tongue_analysis": data["choices"][0]["message"]["content"],
        "syndrome_analysis": "",
        "answer": data["choices"][0]["message"]["content"],
        "symptoms": [],
    }
