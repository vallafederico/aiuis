import { Navigate, useParams } from "@solidjs/router";

/** Schematics moved to `/uis/:slug`; keep old links working. */
export default function UisSchematicsRedirect() {
  const params = useParams();
  return <Navigate href={`/uis/${params.slug}`} />;
}
