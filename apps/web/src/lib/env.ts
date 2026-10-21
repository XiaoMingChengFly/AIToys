/**
 * API 和 zero-cache 的地址。开发时默认本机；生产构建默认和页面同源（部署时由 Caddy 把 /api、/open-api 转给 api，
 * /zero 转给 zero-cache，见 deploy/Caddyfile）。也可以在构建时用 VITE_ 环境变量指定。
 */
export const env = {
  apiUrl: import.meta.env.VITE_API_URL || (import.meta.env.PROD ? window.location.origin : "http://localhost:3000"),
  zeroUrl:
    import.meta.env.VITE_ZERO_URL ||
    (import.meta.env.PROD ? `${window.location.origin}/zero` : "http://localhost:4848"),
};
