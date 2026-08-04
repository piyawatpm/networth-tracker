import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Gate the whole app behind a Supabase session, and refresh that session on
// every request so it doesn't expire mid-use.
//
// This is what makes RLS possible. Until there was a session, the browser
// talked to Supabase with only the publishable key — which ships in the JS
// bundle, so anyone who opened devtools on the deployed site had full read and
// write access to the entire financial database.

/** Paths that must stay reachable without a session. */
const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * API routes authenticate themselves with their own bearer token and run with
 * the service key (the iOS quick-add endpoint, the snapshot cron). Redirecting
 * them to an HTML login page would turn a clean 401 into a confusing 200.
 */
function isExempt(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return true;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates against Supabase — getSession() only reads the
  // cookie, which a client could forge.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isExempt(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Come back to where they were headed after signing in.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets — those don't need a
    // session check and running one on each would cost a round trip per file.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)",
  ],
};
