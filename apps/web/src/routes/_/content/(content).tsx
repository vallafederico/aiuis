import { Title } from "@solidjs/meta";
import { A } from "@acme/router";
import { For } from "solid-js";
import Section from "~/components/Section";
import { getCollection } from "~/content";

const posts = getCollection("posts", (post) => !post.data.draft).sort(
	(a, b) => b.data.date.getTime() - a.data.date.getTime(),
);

export default function Content() {
	return (
		<div class="min-h-[100vh] py-20">
			<Title>Content</Title>

			<Section class="px-gx flex flex-col items-start gap-4">
				<h2>Content</h2>
				<p class="max-w-[60ch] opacity-60">
					File-based mdx collections from <code>src/content</code>, typed and
					validated by <code>@local/content</code>.
				</p>

				<ul class="mt-6 flex flex-col items-start gap-3">
					<For each={posts}>
						{(post) => (
							<li>
								<A animate-hover="underline" href={`/_/content/${post.slug}`}>
									{post.data.title}
								</A>
								<span class="ml-3 text-sm opacity-50">
									{post.data.date.toISOString().slice(0, 10)}
								</span>
							</li>
						)}
					</For>
				</ul>
			</Section>
		</div>
	);
}
