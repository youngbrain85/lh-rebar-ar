// LHRebarARTests/ARModelDecodingTests.swift
import XCTest

final class ARModelDecodingTests: XCTestCase {

    /// 실측 응답 원문을 그대로 먹인다. 지금 DTO 는 여기서 던진다:
    ///   ar_id/scan_id 가 정수인데 String 으로 선언돼 있고, 키가 uploaded_at 인데
    ///   upload_at 을 찾는다.
    func testDecodesRealArListResponse() throws {
        let res = try JSONDecoder().decode(ARListResponse.self, from: DesignModelFixture.arListJSON)
        XCTAssertEqual(res.arList.count, 2)

        let design = try XCTUnwrap(res.arList.first { $0.arType == "design" })
        XCTAssertEqual(design.arID, "2")
        XCTAssertEqual(design.scanID, "101")
        XCTAssertEqual(design.siteID, 1)
        XCTAssertEqual(design.arFilename, "3e471a69bafe402084378cd0cf6dd9f1_002203.usdz")
        XCTAssertEqual(design.typeLabel, "설계모델")
        // 타임스탬프는 source_filename 자리에 밀려 들어와 있다 — 키가 아니라 형식으로 찾는다
        XCTAssertEqual(design.uploadAt, "2026-08-18 00:22:03")
        XCTAssertEqual(design.note, "설계모델 벽체 45가닥")

        let scan = try XCTUnwrap(res.arList.first { $0.arID == "1" })
        XCTAssertEqual(scan.typeLabel, "스캔모델")
    }

    /// 서버가 밀림을 고쳐 upload_at 에 시각을 담아도 그대로 동작해야 한다.
    func testDecodesCorrectedFieldMapping() throws {
        let json = Data("""
        {"status":"success","ar_list":[
          {"scan_id":"101","ar_id":"2","site_id":1,"ar_filename":"m.usdz",
           "ar_type":"design","upload_at":"2026-08-18 00:22:03",
           "source_filename":"Mock-up(2)_2.usdz"}]}
        """.utf8)
        let m = try XCTUnwrap(
            JSONDecoder().decode(ARListResponse.self, from: json).arList.first)
        XCTAssertEqual(m.arID, "2")
        XCTAssertEqual(m.uploadAt, "2026-08-18 00:22:03")
        XCTAssertEqual(m.note, "Mock-up(2)_2.usdz")
    }

    /// 시각 필드가 전부 사라져도 **항목은 살아남아야 한다.** 지금처럼 목록이
    /// 통째로 0건이 되는 것이 진짜 결함이다.
    func testSurvivesMissingTimestampFields() throws {
        let json = Data("""
        {"status":"success","ar_list":[
          {"scan_id":101,"ar_id":2,"site_id":1,"ar_filename":"m.usdz","ar_type":"design"}]}
        """.utf8)
        let m = try XCTUnwrap(
            JSONDecoder().decode(ARListResponse.self, from: json).arList.first)
        XCTAssertEqual(m.arID, "2")
        XCTAssertNil(m.uploadAt)
        XCTAssertNil(m.note)
        // 캐시 키는 파일명으로 대체된다 — 파일명이 해시+시각이라 재업로드마다 바뀐다
        XCTAssertEqual(m.versionStamp, "m.usdz")
    }

    func testVersionStampStripsPunctuation() throws {
        let m = try XCTUnwrap(
            JSONDecoder().decode(ARListResponse.self, from: DesignModelFixture.arListJSON)
                .arList.first { $0.arType == "design" })
        XCTAssertEqual(m.versionStamp, "20260818_002203")
    }

    /// ar_id 가 없으면 그 항목은 못 쓴다 — 조용히 통과시키지 않는다.
    func testThrowsWhenArIdMissing() {
        let json = Data("""
        {"status":"success","ar_list":[{"site_id":1,"ar_filename":"m.usdz","ar_type":"design"}]}
        """.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ARListResponse.self, from: json))
    }
}
