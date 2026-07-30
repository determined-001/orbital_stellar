import { runVerification } from "@/lib/registry";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runVerification();
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: "verification_failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
