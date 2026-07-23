import { useParams } from "@solidjs/router";
import { Show } from "solid-js";
import { MDXContent, PageMeta } from "@local/content/solid";
import Section from "~/components/Section";
import { mdxComponents } from "~/components/content/mdx";
import { getEntry } from "~/content";

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
						<PageMeta data={post.data} />

						<h1>{post.data.title}</h1>
						<time class="text-sm opacity-50">
							{post.data.date.toISOString().slice(0, 10)}
						</time>

						<article class="mt-6 flex max-w-[65ch] flex-col gap-4">
							<MDXContent entry={post} components={mdxComponents} />
						</article>
					</Section>
				)}
			</Show>
		</div>
	);
}
