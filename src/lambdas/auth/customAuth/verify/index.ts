import { VerifyAuthChallengeResponseTriggerEvent } from "aws-lambda";
import { verifySocialAuthProof } from "../../../utils/auth/socialAuthProof";

export const handler = async (
  event: VerifyAuthChallengeResponseTriggerEvent,
): Promise<VerifyAuthChallengeResponseTriggerEvent> => {
  const secret = process.env.SOCIAL_AUTH_SECRET || "";
  const privateParameters = event.request.privateChallengeParameters ?? {};
  const nonce = privateParameters.nonce || "";
  const provider =
    privateParameters.provider || event.request.clientMetadata?.provider || "";
  const providerSubject =
    privateParameters.providerSubject ||
    event.request.clientMetadata?.providerSubject ||
    "";
  const answer = event.request.challengeAnswer || "";

  event.response.answerCorrect =
    Boolean(secret) &&
    verifySocialAuthProof({
      secret,
      answer,
      provider,
      providerSubject,
      cognitoUsername: event.userName,
      nonce,
      clientId: event.callerContext.clientId,
    });

  return event;
};
