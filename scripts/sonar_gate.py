#!/usr/bin/env python3
"""Require fresh Sonar analysis and zero software-quality issues or duplication."""

import argparse
import http.client
import json
import os
from urllib.parse import urlencode

METRICS = (
    "software_quality_security_issues",
    "software_quality_reliability_issues",
    "software_quality_maintainability_issues",
    "duplicated_lines",
    "duplicated_lines_density",
    "security_hotspots",
)


def request(endpoint: str, parameters: dict[str, str]) -> dict:
    """Query Sonar without putting the credential in URLs or diagnostics."""
    token = os.environ.get("SONAR_TOKEN")
    if not token:
        raise ValueError("SONAR_TOKEN is required; analysis cannot be skipped")
    connection = http.client.HTTPSConnection("sonarcloud.io", timeout=30)
    try:
        connection.request(
            "GET",
            "/api/" + endpoint + "?" + urlencode(parameters),
            headers={"Authorization": "Bearer " + token},
        )
        response = connection.getresponse()
        if response.status != 200:
            raise RuntimeError(f"Sonar {endpoint} failed: HTTP {response.status}")
        data = response.read(4 * 1024 * 1024 + 1)
        if len(data) > 4 * 1024 * 1024:
            raise ValueError("Sonar response exceeds size limit")
        return json.loads(data)
    finally:
        connection.close()


def validate_branch(branches: list[dict], expected_name: str) -> None:
    """Require overall-code analysis rather than new-code-only short branches."""
    branch = next((item for item in branches if item.get("name") == expected_name), None)
    if branch is None:
        raise ValueError("No Sonar analysis exists for the checked branch")
    if branch.get("type") != "LONG":
        raise ValueError("Sonar must analyze overall code on a long-lived branch")


def pull_request_revision(pull_requests: list[dict], key: str) -> str:
    """Read the checked PR's analyzed revision, without logging account metadata."""
    review = next((item for item in pull_requests if item.get("key") == key), None)
    if review is None:
        raise ValueError("No Sonar analysis exists for the checked pull request")
    if review.get("base") != "main":
        raise ValueError("Sonar pull request analysis must target main")
    return review.get("commit", {}).get("sha", "")


def validate(measures: list[dict], analyzed_revision: str, expected_revision: str) -> None:
    """Reject stale, incomplete, or nonzero results, including rounded duplication."""
    if analyzed_revision != expected_revision:
        raise ValueError("Sonar analysis does not match the checked commit")
    values = {measure["metric"]: measure["value"] for measure in measures}
    missing = set(METRICS) - values.keys()
    if missing:
        raise ValueError("Missing Sonar metrics: " + ", ".join(sorted(missing)))
    failures = [f"{name}={values[name]}" for name in METRICS if float(values[name]) != 0]
    if failures:
        raise ValueError("Sonar policy failed: " + ", ".join(failures))


def main() -> None:
    """Check completed analysis for the exact branch and commit."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--revision", required=True)
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--branch", default="main")
    scope.add_argument("--pull-request")
    args = parser.parse_args()
    if args.pull_request:
        selection = {"pullRequest": args.pull_request}
        reviews = request("project_pull_requests/list", {"project": args.project})["pullRequests"]
        revision = pull_request_revision(reviews, args.pull_request)
    else:
        selection = {"branch": args.branch}
        branches = request("project_branches/list", {"project": args.project})["branches"]
        validate_branch(branches, args.branch)
        analyses = request(
            "project_analyses/search", {"project": args.project, **selection, "ps": "1"}
        )["analyses"]
        if not analyses:
            raise ValueError("No Sonar analysis exists for this branch")
        revision = analyses[0].get("revision", "")
    measures = request(
        "measures/component",
        {"component": args.project, **selection, "metricKeys": ",".join(METRICS)},
    )["component"]["measures"]
    validate(measures, revision, args.revision)
    dismissed = request(
        "issues/search",
        {
            "componentKeys": args.project,
            **selection,
            "issueStatuses": "ACCEPTED,FALSE_POSITIVE",
            "ps": "1",
        },
    )
    if dismissed["total"]:
        raise ValueError("Sonar findings were dismissed instead of fixed")
    print(
        f"PASS: current {'PR changes' if args.pull_request else 'overall code'} "
        "have zero security, reliability, maintainability, "
        "hotspots, and duplicated lines"
    )


if __name__ == "__main__":
    main()
