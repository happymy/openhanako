import { parseDeferredResultNotification } from "./deferred-result-notification.ts";

export const TURN_INPUT_PRESENTATION_EVENT_TYPE = "turn_input_presentation";

function textOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildTurnInputPresentationEvent(message, { deliveryMode = null } = {}) {
  const parsed = parseDeferredResultNotification(message?.content);
  if (!parsed?.taskId) return null;
  const details = message?.details && typeof message.details === "object" ? message.details : null;
  const deliveryId = textOrNull(details?.deliveryId);

  return {
    type: TURN_INPUT_PRESENTATION_EVENT_TYPE,
    presentation: {
      kind: "pre_reply_interlude",
      inputKind: "custom_message",
      customType: message?.customType || null,
      ...(deliveryId ? { deliveryId } : {}),
      taskId: parsed.taskId,
      status: parsed.status === "failed" || parsed.status === "aborted" ? parsed.status : "success",
      resultType: parsed.type || "background-task",
      ...(Object.prototype.hasOwnProperty.call(parsed, "result") ? { result: parsed.result } : {}),
      ...(parsed.reason ? { reason: parsed.reason } : {}),
      ...(deliveryMode ? { deliveryMode } : {}),
    },
  };
}

export function buildTurnInputPresentationRecord(presentation, block) {
  if (!presentation || !block) return null;
  const deliveryId = textOrNull(presentation.deliveryId) || textOrNull(block.deliveryId);
  return {
    schemaVersion: 1,
    ...(deliveryId ? { deliveryId } : {}),
    presentation,
    block,
  };
}

export function parseTurnInputPresentationRecord(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const block = data.block && typeof data.block === "object" && !Array.isArray(data.block)
    ? data.block
    : null;
  if (block?.type !== "interlude") return null;
  return {
    deliveryId: textOrNull(data.deliveryId) || textOrNull(block.deliveryId),
    presentation: data.presentation && typeof data.presentation === "object" && !Array.isArray(data.presentation)
      ? data.presentation
      : null,
    block,
  };
}
