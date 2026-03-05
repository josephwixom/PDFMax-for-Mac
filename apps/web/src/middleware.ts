import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PATHS = ['/login'];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // ── Offline / unconfigured mode ────────────────────────────────────────────
    // If Supabase env vars are not set, skip all auth checks so the app is
    // fully usable locally without any backend configuration.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const skipAuth = process.env.PDFMAX_SKIP_AUTH === 'true';
    if (skipAuth || !supabaseUrl || !supabaseKey ||
        supabaseUrl === 'https://your-project-id.supabase.co') {
        return NextResponse.next();
    }

    // Allow public paths through without auth check
    if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
        const response = NextResponse.next();
        try {
            const sb = createServerClient(supabaseUrl, supabaseKey,
                { cookies: { getAll: () => request.cookies.getAll(), setAll: () => { } } }
            );
            const { data: { session } } = await sb.auth.getSession();
            // If already logged in and hitting /login, redirect to app
            if (session) {
                return NextResponse.redirect(new URL('/', request.url));
            }
        } catch {
            // Supabase unreachable (offline) — just show the login page
        }
        return response;
    }

    // For all other routes, require a session
    const response = NextResponse.next({
        request: { headers: request.headers },
    });

    const sb = createServerClient(supabaseUrl, supabaseKey,
        {
            cookies: {
                getAll: () => request.cookies.getAll(),
                setAll: (cookiesToSet) => {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        response.cookies.set(name, value, options);
                    });
                },
            },
        }
    );

    try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) {
            const loginUrl = new URL('/login', request.url);
            // Preserve the full URL (pathname + query string) so ?session= share
            // links survive the login redirect without being silently dropped.
            const fullPath = pathname + request.nextUrl.search;
            loginUrl.searchParams.set('next', fullPath);
            return NextResponse.redirect(loginUrl);
        }
    } catch {
        // Supabase unreachable (offline) — fail-open so the cached app is usable.
        console.warn('[middleware] Supabase unreachable — allowing through for offline use');
    }

    return response;
}


export const config = {
    matcher: [
        // Match all routes except static files, api, _next internals
        '/((?!_next/static|_next/image|favicon.ico|icon-|apple-touch|manifest).*)',
    ],
};
