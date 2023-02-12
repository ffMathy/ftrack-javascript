// :copyright: Copyright (c) 2022 ftrack
import { beforeAll } from "vitest";

import { v4 as uuidV4 } from "uuid";
import loglevel from "loglevel";
import moment from "moment";
import {
  ServerPermissionDeniedError,
  ServerValidationError,
  ServerError,
} from "../source/error";
import { Session } from "../source/session";
import * as operation from "../source/operation";
import { expect } from "chai";

const logger = loglevel.getLogger("test_session");
logger.setLevel("debug");

const credentials = {
  serverUrl: "http://ftrack.test",
  apiUser: "testuser",
  apiKey: "testkey",
};
let session = null;

function getTestUsername() {
  return `testName-${uuidV4()}`; // Use the same test user name format as the E2E tests. Simplifies cleanup if running the tests against a real server.
}

beforeAll(() => {
  session = new Session(
    credentials.serverUrl,
    credentials.apiUser,
    credentials.apiKey,
    {
      autoConnectEventHub: false,
    }
  );
});

describe("Session", () => {
  logger.debug("Running session tests.");

  it("Should initialize the session automatically", async () => {
    await expect(session.initializing).resolves.toBeTruthy();
  });

  it("Should reject invalid credentials", async () => {
    const badSession = new Session(
      credentials.serverUrl,
      credentials.apiUser,
      "INVALID_API_KEY",
      {
        autoConnectEventHub: false,
      }
    );
    await expect(badSession.initializing).rejects.toThrow(ServerError);
  });

  it("Should allow querying a Task", () =>
    expect(
      session
        .query("select name from Task limit 1")
        .then((response) => response.data[0].__entity_type__)
    ).resolves.toEqual("Task"));

  it("Should allow creating a User", () => {
    const promise = session.create("User", {
      username: getTestUsername(),
    });

    return expect(
      promise.then((response) => response.data.__entity_type__)
    ).resolves.toEqual("User");
  });

  it("Should allow deleting a User", async () => {
    const username = getTestUsername();
    let promise = session.create("User", {
      username,
    });

    promise = promise.then((newUserResponse) => {
      const userId = newUserResponse.data.id;
      const deletePromise = session.delete("User", userId);
      return deletePromise;
    });

    await expect(
      promise.then((response) => response.data)
    ).resolves.toBeTruthy();
  });

  it("Should allow updating a User", async () => {
    const username = getTestUsername();
    const shortUsername = username.slice(0, -30);
    let promise = session.create("User", {
      shortUsername,
    });

    promise = promise.then((newUserResponse) => {
      const userId = newUserResponse.data.id;
      const updatePromise = session.update("User", userId, {
        username: username,
      });

      return updatePromise;
    });
    // Checks a regex matching the username generated by getTestUsername()
    await expect(
      promise.then((response) => response.data.username)
    ).resolves.toMatch(/^testName-[0-9a-f-]{36}$/);
  });

  it("Should decode batched query operations", async () => {
    const responses = await session.call([
      operation.query(
        "select status.state.short from Task where status.state.short is NOT_STARTED limit 1"
      ),
      operation.query(
        "select status.state.short from Task where status.state.short is NOT_STARTED limit 1"
      ),
    ]);
    const status1 = responses[0].data[0].status;
    const status2 = responses[1].data[0].status;
    expect(status1.state.short).toEqual("NOT_STARTED");
    expect(status2.state.short).toEqual("NOT_STARTED");
    expect(status1).toEqual(status2);
  });

  it("Should support uploading files", async () => {
    const data = { foo: "bar" };
    const file = new File([JSON.stringify(data)], "data.json", {
      type: "application/json",
    });

    const response = await session.createComponent(file);
    expect(response[0].data.__entity_type__).toEqual("FileComponent");
    expect(response[0].data.file_type).toEqual(".json");
    expect(response[0].data.name).toEqual("data");
  });

  it("Should support uploading blob", () => {
    const data = { foo: "bar" };
    const blob = new Blob([JSON.stringify(data)], {
      type: "application/json",
    });

    return session.createComponent(blob, {
      name: "data.json",
    });
  });

  it("Should support abort of uploading file", async () => {
    const data = { foo: "bar" };
    const blob = new Blob([JSON.stringify(data)], {
      type: "application/json",
    });

    const xhr = new XMLHttpRequest();
    const promise = new Promise((resolve) => {
      const onAborted = () => {
        resolve(true);
      };

      session.createComponent(blob, {
        xhr,
        name: "data.json",
        onProgress: () => {
          xhr.abort();
        },
        onAborted,
      });
    });
    await expect(promise).resolves.toEqual(true);
  });

  it.skip("Should support ensure with create", async () => {
    const identifyingKeys = ["key", "parent_id", "parent_type"];
    const key = uuidV4();

    let user;
    await session.initializing;
    const { data } = await session.query(
      `select id from User where username is "${session.apiUser}"`
    );
    user = data[0];
    const ensuredData = await session.ensure(
      "Metadata",
      {
        key,
        value: "foo",
        parent_id: user.id,
        parent_type: "User",
      },
      identifyingKeys
    );
    expect(ensuredData.__entity_type__).toEqual("Metadata");
    expect(ensuredData.key).toEqual(key);
    expect(ensuredData.value).toEqual("foo");
    expect(ensuredData.parent_id).toEqual(user.id);
    expect(ensuredData.parent_type).toEqual("User");
  });

  it.skip("Should support ensure with update", async (done) => {
    const identifyingKeys = ["key", "parent_id", "parent_type"];
    const key = uuidV4();

    let user;
    const promise = session.initializing
      .then(() =>
        session.query(
          `select id from User where username is "${session.apiUser}"`
        )
      )
      .then(({ data }) => {
        user = data[0];
        return session.create("Metadata", {
          key,
          value: "foo",
          parent_id: user.id,
          parent_type: "User",
        });
      })
      .then(() =>
        session.ensure(
          "Metadata",
          {
            key,
            value: "bar",
            parent_id: user.id,
            parent_type: "User",
          },
          identifyingKeys
        )
      );
    promise
      .then((data) => {
        try {
          data.__entity_type__.should.equal("Metadata");
          data.key.should.equal(key);
          data.value.should.equal("bar");
          data.parent_id.should.equal(user.id);
          data.parent_type.should.equal("User");
        } catch (error) {
          done(error);
        }
      })
      .then(done);
  });

  it.skip("Should support ensure with update moment object as criteria", async (done) => {
    const now = moment();

    const name = uuidV4();

    const promise = session.initializing
      .then(() =>
        session.create("Project", {
          start_date: now,
          end_date: now,
          name,
          full_name: "foo",
        })
      )
      .then(() =>
        session.ensure(
          "Project",
          {
            start_date: now,
            end_date: now,
            name,
            full_name: "bar",
          },
          ["start_date"]
        )
      );
    promise
      .then((data) => {
        try {
          data.__entity_type__.should.equal("Project");
          data.full_name.should.equal("bar");
        } catch (error) {
          done(error);
        }
      })
      .then(done);
  });

  it("Should support uploading files with custom component id", async () => {
    const componentId = uuidV4();
    const data = { foo: "bar" };
    const blob = new Blob([JSON.stringify(data)], {
      type: "application/json",
    });

    const response = await session.createComponent(blob, {
      name: "data.json",
      data: { id: componentId },
    });

    expect(response[0].data.id).toEqual(componentId);
  });

  it("Should support generating thumbnail URL with + in username", () => {
    const componentId = uuidV4();
    const previousUser = session.apiUser;
    session.apiUser = "user+test@example.com";
    const url = session.thumbnailUrl(componentId);
    expect(url).toEqual(
      `${credentials.serverUrl}/component/thumbnail?` +
        `id=${componentId}&size=300` +
        `&username=${encodeURIComponent(session.apiUser)}` +
        `&apiKey=${credentials.apiKey}`
    );
    session.apiUser = previousUser;
  });

  it("Should support encoding moment dates", () => {
    const now = moment();
    const output = session.encode([{ foo: now, bar: "baz" }, 12321]);
    expect(output).toEqual([
      {
        foo: {
          __type__: "datetime",
          value: now.format("YYYY-MM-DDTHH:mm:ss"),
        },
        bar: "baz",
      },
      12321,
    ]);
  });

  it("Should return correct error", () => {
    expect(
      session.getErrorFromResponse({
        exception: "PermissionError",
        content: "foo",
      })
    ).toBeInstanceOf(ServerPermissionDeniedError);
    expect(
      session.getErrorFromResponse({
        exception: "FTAuthenticationError",
        content: "foo",
      })
    ).toBeInstanceOf(ServerPermissionDeniedError);
    expect(
      session.getErrorFromResponse({
        exception: "ValidationError",
        content: "foo",
      })
    ).toBeInstanceOf(ServerValidationError);
    expect(
      session.getErrorFromResponse({
        exception: "Foo",
        content: "foo",
      })
    ).toBeInstanceOf(ServerError);
  });
});
