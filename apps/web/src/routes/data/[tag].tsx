import { lazy } from "solid-js";
import { useParams } from "@solidjs/router";
import { getTagPage } from "~/lib/tags";

const TagView = lazy(() => import("~/components/cms/TagView"));

export const route = {
  preload: ({ params }: { params: { tag: string } }) => getTagPage(params.tag),
};

export default function DataTag() {
  const params = useParams();
  return <TagView tag={params.tag} />;
}
