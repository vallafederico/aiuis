import { useParams } from "@solidjs/router";
import { TagView, getTagPage } from "~/components/cms/TagView";

export const route = {
  preload: ({ params }: { params: { tag: string } }) => getTagPage(params.tag),
};

export default function DataTag() {
  const params = useParams();
  return <TagView tag={params.tag} />;
}
