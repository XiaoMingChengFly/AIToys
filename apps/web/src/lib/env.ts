/** API 和 zero-cache 的地址。开发时默认本机；部署时用 VITE_ 环境变量在构建时注入。 */
export const env = {
  apiUrl: import.meta.env.VITE_API_URL ?? "http://localhost:3000",
  zeroUrl: import.meta.env.VITE_ZERO_URL ?? "http://localhost:4848",
};
