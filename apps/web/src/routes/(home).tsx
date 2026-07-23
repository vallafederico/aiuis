import { A } from "@acme/router";
import Metadata from "~/components/Metadata";

export default function Home() {
	return (
		<div class="min-h-[100vh] pt-20">
			<Metadata
				title="aiuis"
				description="Solid start, native webgl, mdx content."
			/>

			<div class="px-gx flex flex-col items-start gap-4">
				<h1>aiuis</h1>
				<p class="max-w-[60ch]">
					Solid start monorepo — file-based mdx content via{" "}
					<code>@local/content</code>, webgl via <code>@ssscript/webgl</code>.
				</p>
				<A animate-hover="underline" href="/_/content">
					Read the content demo
				</A>
			</div>
		</div>
	);
}
