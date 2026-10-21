import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./index.css";
import { FlowDemo } from "./flow-demo/FlowDemo.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("缺少 #root 节点");

createRoot(root).render(
  <StrictMode>
    <FlowDemo />
  </StrictMode>,
);
