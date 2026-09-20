import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/payments/route";

const RECIPIENT = "0x1111111111111111111111111111111111111111";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/payments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/payments", () => {
  it("creates a payment and returns 201", async () => {
    const response = await POST(
      makeRequest({
        amountUsdc: "5.00",
        description: "Design work",
        recipient: RECIPIENT,
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.status).toBe("PENDING");
    expect(body.paymentUrl).toMatch(/^\/pay\//);
    expect(body.id).toBeTruthy();
  });

  it("returns 400 for an invalid amount", async () => {
    const response = await POST(
      makeRequest({
        amountUsdc: "1.0000001",
        description: "Design work",
        recipient: RECIPIENT,
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for an invalid recipient", async () => {
    const response = await POST(
      makeRequest({
        amountUsdc: "5.00",
        description: "Design work",
        recipient: "nope",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when fields are missing", async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a non-JSON body", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("ignores a client-provided status", async () => {
    const response = await POST(
      makeRequest({
        amountUsdc: "5.00",
        description: "Design work",
        recipient: RECIPIENT,
        status: "CONFIRMED",
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.status).toBe("PENDING");
    expect(body.payment.status).toBe("PENDING");
  });
});
