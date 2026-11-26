import { getProductDoc, PRODUCT_DOCS, renderProductDoc } from "@/lib/product-docs";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return PRODUCT_DOCS.map((doc) => ({ topic: doc.slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ topic: string }> }): Promise<Response> {
  const { topic } = await params;
  const doc = getProductDoc(topic);
  if (!doc) return new Response("Not found", { status: 404 });
  return new Response(renderProductDoc(doc), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
