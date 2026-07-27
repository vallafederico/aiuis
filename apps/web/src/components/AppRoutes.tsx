import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";

export default function AppRoutes() {
  return (
    <Suspense fallback={<div>loading things</div>}>
      <FileRoutes />
    </Suspense>
  );
}
