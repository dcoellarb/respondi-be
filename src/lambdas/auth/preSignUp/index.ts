/**
 * Cognito pre sign-up trigger.
 * Confirms the user immediately so email/password signup can return tokens
 * in the same request. Email delivery for password reset still uses Cognito.
 */
import { PreSignUpTriggerEvent } from "aws-lambda";

export const handler = async (
  event: PreSignUpTriggerEvent,
): Promise<PreSignUpTriggerEvent> => {
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};
