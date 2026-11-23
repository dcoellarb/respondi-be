import { CreateAuthChallengeTriggerEvent } from "aws-lambda";
import { createSocialAuthNonce } from "../../../utils/auth/socialAuthProof";

export const handler = async (
  event: CreateAuthChallengeTriggerEvent,
): Promise<CreateAuthChallengeTriggerEvent> => {
  const nonce = createSocialAuthNonce();
  event.response.publicChallengeParameters = { nonce };
  event.response.privateChallengeParameters = {
    nonce,
    provider: event.request.clientMetadata?.provider ?? "",
    providerSubject: event.request.clientMetadata?.providerSubject ?? "",
  };
  event.response.challengeMetadata = "SOCIAL_AUTH";
  return event;
};
