// 带鉴权的 fetch 封装 + openapi 类型接线,供 api/ 各模块共用
import type { paths } from "./schema";

export const API_BASE = "/api";

type JsonBody<T> = T extends { content: { "application/json": infer J } }
  ? J
  : unknown;

type Operation<
  P extends keyof paths,
  M extends keyof paths[P],
> = NonNullable<paths[P][M]>;

type RequestBody<
  P extends keyof paths,
  M extends keyof paths[P],
> = Operation<P, M> extends { requestBody?: infer R } ? NonNullable<R> : never;

/**
 * 按路径/方法从生成的 openapi schema 提取请求体类型。
 * 默认提取 JSON；上传接口可把第三个参数指定为 multipart/form-data。
 */
export type ApiRequestBody<
  P extends keyof paths,
  M extends keyof paths[P],
  MediaType extends string = "application/json",
> = RequestBody<P, M> extends { content: infer Content }
  ? MediaType extends keyof Content
    ? Content[MediaType]
    : never
  : never;

/**
 * 按路径/方法从生成的 openapi schema 提取 200 响应的 JSON 类型。
 * 类型由 contracts 中的响应 schema 生成；修改契约后运行 bun run gen:api。
 * 未声明具体结构的接口仍保留 unknown，已收紧的接口自动获得对应 DTO。
 */
export type ApiResponse<
  P extends keyof paths,
  M extends keyof paths[P],
> = paths[P][M] extends { responses: { 200: infer R } } ? JsonBody<R> : unknown;

/**
 * 后端错误码的全局处理器。401 已在下面直接处理(必须跳登录,没有商量余地);
 * 其余带 code 的错误交给这里,让不同部署各自决定怎么呈现——比如额度用尽是
 * 引导去设置、还是弹自家的付费流程。未注册处理器时行为与从前一致:原样把
 * Response 交回调用方。
 *
 * 返回 true 表示已接管(调用方会拿到一个 rejected promise,不必再自行处理)。
 */
export type ApiErrorHandler = (
  code: string,
  body: Record<string, unknown>,
  res: Response
) => boolean | void;

let apiErrorHandler: ApiErrorHandler | null = null;

export function setApiErrorHandler(handler: ApiErrorHandler | null): void {
  apiErrorHandler = handler;
}

/** 处理器接管后抛出的标记异常,调用方可据此跳过自己的错误提示。 */
export class HandledApiError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "HandledApiError";
  }
}

function authHeaders(extra: HeadersInit = {}): Record<string, string> {
  const token = localStorage.getItem("token");
  const headers: Record<string, string> = { ...(extra as Record<string, string>) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = authHeaders(options.headers);
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  if (!res.ok && apiErrorHandler) {
    // clone:处理器只是旁观,body 必须原样留给调用方。
    const body = await res
      .clone()
      .json()
      .catch(() => null);
    const code = typeof body?.code === "string" ? body.code : "";
    if (code && apiErrorHandler(code, body, res) === true) {
      throw new HandledApiError(code);
    }
  }
  return res;
}

export { consumeSSE } from './sse';
