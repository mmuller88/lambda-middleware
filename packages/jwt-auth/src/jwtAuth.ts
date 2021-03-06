import { PromiseHandler } from "@lambda-middleware/utils";
import { APIGatewayEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import createHttpError from "http-errors";
import jwt, { NotBeforeError, TokenExpiredError } from "jsonwebtoken";

import { getTokenFromAuthHeader } from "./helpers/getTokenFromAuthHeader";
import { getTokenFromSource } from "./helpers/getTokenFromSource";
import {
  AuthOptions,
  EncryptionAlgorithms,
  isAuthOptions,
} from "./interfaces/AuthOptions";
import { AuthorizedEvent } from "./interfaces/AuthorizedEvent";
import { logger } from "./logger";

export const jwtAuth = <Payload, CredentialsRequired>(
  options: AuthOptions<Payload, CredentialsRequired>
) => {
  if (!isAuthOptions(options)) {
    throw new TypeError(
      `Expected AuthOptions, received ${JSON.stringify(options)} instead`
    );
  }
  return (
    handler: PromiseHandler<
      APIGatewayEvent &
        (CredentialsRequired extends true
          ? AuthorizedEvent<Payload>
          : Partial<AuthorizedEvent<Payload>>),
      APIGatewayProxyResult
    >
  ) => async (
    event: APIGatewayEvent,
    context: Context
  ): Promise<APIGatewayProxyResult> => {
    if ((event as any).auth !== undefined) {
      logger("event.auth already populated, has to be empty");
      throw createHttpError(400, "The events auth property has to be empty", {
        type: "EventAuthNotEmpty",
      });
    }

    const token =
      getTokenFromSource(event, options.tokenSource) ??
      getTokenFromAuthHeader(event);

    if (token === undefined) {
      logger("No authorization header found");

      if (options.credentialsRequired) {
        throw createHttpError(
          401,
          "No valid bearer token was set in the authorization header",
          {
            type: "AuthenticationRequired",
          }
        );
      }

      return await handler(event as any, context);
    }

    logger("Verifying authorization token");
    try {
      jwt.verify(token, options.secretOrPublicKey, {
        algorithms: [options.algorithm],
      });
      logger("Token verified");
    } catch (err) {
      logger("Token could not be verified");

      if (err instanceof TokenExpiredError) {
        logger(`Token expired at ${new Date(err.expiredAt).toUTCString()}`);
        throw createHttpError(
          401,
          `Token expired at ${new Date(err.expiredAt).toUTCString()}`,
          {
            expiredAt: err.expiredAt,
            type: "TokenExpiredError",
          }
        );
      }

      if (err instanceof NotBeforeError) {
        logger(`Token not valid before ${err.date}`);
        throw createHttpError(401, `Token not valid before ${err.date}`, {
          date: err.date,
          type: "NotBeforeError",
        });
      }

      throw createHttpError(401, "Invalid token", {
        type: "InvalidToken",
      });
    }

    const payload = jwt.decode(token);
    if (options.isPayload !== undefined) {
      logger("Verifying token payload");
      if (!options.isPayload(payload)) {
        logger(`Token payload malformed, was ${JSON.stringify(payload)}`);
        throw createHttpError(
          400,
          `Token payload malformed, was ${JSON.stringify(payload)}`,
          {
            payload,
            type: "TokenPayloadMalformedError",
          }
        );
      }
      logger("Token payload valid");
    }

    const auth = {
      payload: jwt.decode(token),
      token,
    };
    return await handler({ ...event, auth } as any, context);
  };
};

export { EncryptionAlgorithms, AuthOptions, isAuthOptions };
export {
  AuthorizedEvent,
  isAuthorizedEvent,
} from "./interfaces/AuthorizedEvent";
