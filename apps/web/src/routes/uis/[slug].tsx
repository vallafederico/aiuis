import { useParams } from "@solidjs/router";
import { PieceView, getPiece } from "~/components/cms/PieceView";

export const route = {
  preload: ({ params }: { params: { slug: string } }) =>
    getPiece(params.slug, "uis"),
};

export default function UisPiece() {
  const params = useParams();
  // UI pieces stay at the text width for now; widen here (e.g.
  // width="w-grids-8", eventually per-piece from schema data) as
  // interactive content lands.
  return <PieceView slug={params.slug} section="uis" />;
}
