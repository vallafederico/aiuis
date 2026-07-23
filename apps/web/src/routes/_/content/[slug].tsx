import { useParams } from "@solidjs/router";
import { Show, type JSX } from "solid-js";
import { MDXContent } from "@local/content/solid";
import Section from "~/components/Section";
import Metadata from "~/components/Metadata";
import { getEntry } from "~/content";

// injected into the mdx scope — usable in posts without an import
const Marker = (props: { children?: JSX.Element }) => (
	<mark class="bg-key/15 text-key px-1">{props.children}</mark>
);

export default function Post() {
	const params = useParams();
	const entry = () => getEntry("posts", params.slug);

	return (
		<div class="min-h-[100vh] py-20">
			<Show
				when={entry()}
				keyed
				fallback={
					<Section class="px-gx">
						<p>No such post.</p>
					</Section>
				}
			>
				{(post) => (
					<Section class="px-gx flex flex-col items-start gap-4">
						<Metadata
							title={post.data.title}
							description={post.data.description}
						/>

						<h1>{post.data.title}</h1>
						<time class="text-sm opacity-50">
							{post.data.date.toISOString().slice(0, 10)}
						</time>

						<article class="mt-6 flex max-w-[65ch] flex-col gap-4">
							<MDXContent entry={post} components={{ Marker }} />
						</article>
					</Section>
				)}
			</Show>
		</div>
	);
}
