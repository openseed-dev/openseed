import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const headers = { "Content-Type": "application/json" };

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid JSON" }), {
      status: 400,
      headers,
    });
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(
      JSON.stringify({ ok: false, error: "valid email is required" }),
      { status: 400, headers },
    );
  }

  const name = (body.name || "").trim().slice(0, 200) || null;
  const plan = (body.plan || "").trim().slice(0, 50) || null;
  const use_case = (body.use_case || "").trim().slice(0, 1000) || null;

  const db = (locals as any).runtime?.env?.DB;
  if (!db) {
    console.error("[waitlist] D1 binding not available");
    return new Response(
      JSON.stringify({ ok: false, error: "server configuration error" }),
      { status: 500, headers },
    );
  }

  try {
    await db
      .prepare(
        "INSERT INTO waitlist (email, name, plan, use_case) VALUES (?, ?, ?, ?)",
      )
      .bind(email, name, plan, use_case)
      .run();

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint")) {
      return new Response(
        JSON.stringify({ ok: true, message: "already on the list" }),
        { status: 200, headers },
      );
    }
    console.error("[waitlist] insert error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: "server error" }),
      { status: 500, headers },
    );
  }
};
