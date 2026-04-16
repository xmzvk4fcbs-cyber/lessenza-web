import type { Handler } from "@netlify/functions";
import { methodNotAllowed, serverError } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { createState, getAuthUrl } from "../lib/google-auth";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  try {
    const state = await createState();
    const url = await getAuthUrl(state);
    return {
      statusCode: 302,
      headers: { Location: url },
      body: "",
    };
  } catch (e) {
    return serverError((e as Error).message);
  }
};

export const handler = adminGuard(inner);
