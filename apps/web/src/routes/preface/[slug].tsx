import { lazy } from "solid-js";
import { useParams } from "@solidjs/router";
import { getPiece } from "~/lib/piece";

const PieceView = lazy(() => import("~/components/cms/PieceView"));

export const route = {
  preload: ({ params }: { params: { slug: string } }) =>
    getPiece(params.slug, "preface"),
};

export default function PrefacePiece() {
  const params = useParams();
  return <PieceView slug={params.slug} section="preface" />;
}
