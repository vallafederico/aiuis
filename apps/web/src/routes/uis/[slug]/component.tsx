import { Navigate, useParams } from "@solidjs/router";

/** The component view moved to `/uis/:slug`; keep old links working. */
export default function UisComponentRedirect() {
  const params = useParams();
  return <Navigate href={`/uis/${params.slug}`} />;
}
