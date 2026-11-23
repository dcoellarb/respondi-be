import { DefineAuthChallengeTriggerEvent } from "aws-lambda";

export const handler = async (
  event: DefineAuthChallengeTriggerEvent,
): Promise<DefineAuthChallengeTriggerEvent> => {
  const session = event.request.session ?? [];

  if (session.length === 0) {
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = "CUSTOM_CHALLENGE";
    return event;
  }

  const last = session[session.length - 1];
  if (
    session.length === 1 &&
    last.challengeName === "CUSTOM_CHALLENGE" &&
    last.challengeResult === true
  ) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
    return event;
  }

  event.response.issueTokens = false;
  event.response.failAuthentication = true;
  return event;
};
