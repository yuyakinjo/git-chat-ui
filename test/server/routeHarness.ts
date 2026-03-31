import type { Request, Response, Router } from "express";

type RouteMethod = "get" | "post" | "put";

interface ExpressLayer {
  route?: {
    path: string;
    methods: Partial<Record<RouteMethod, boolean>>;
    stack: Array<{ handle: (request: Request, response: Response, next: (error?: unknown) => void) => unknown }>;
  };
}

export async function invokeJsonRoute(
  router: Router,
  method: RouteMethod,
  path: string,
  {
    body = {},
    query = {},
  }: {
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
  } = {},
): Promise<{ statusCode: number; body: unknown }> {
  const layer = ((router as unknown as { stack?: ExpressLayer[] }).stack ?? []).find(
    (candidate) =>
      candidate.route?.path === path && candidate.route.methods[method] === true,
  );

  const handle = layer?.route?.stack[0]?.handle;
  if (!handle) {
    throw new Error(`Route ${method.toUpperCase()} ${path} was not found.`);
  }

  let statusCode = 200;

  return await new Promise((resolve, reject) => {
    const response = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        resolve({ statusCode, body: payload });
        return this;
      },
    } as unknown as Response;

    const next = (error?: unknown): void => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ statusCode, body: undefined });
    };

    Promise.resolve(
      handle(
        {
          body,
          query,
        } as Request,
        response,
        next,
      ),
    ).catch(reject);
  });
}
