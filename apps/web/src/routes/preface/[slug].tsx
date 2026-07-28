import { useParams } from "@solidjs/router";
import { PieceView, getPiece } from "~/components/cms/PieceView";

export const route = {
  preload: ({ params }: { params: { slug: string } }) =>
    getPiece(params.slug, "preface"),
};

export default function PrefacePiece() {
  const params = useParams();
  return <PieceView slug={params.slug} section="preface" />;
}
