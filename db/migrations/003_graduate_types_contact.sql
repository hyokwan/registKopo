-- 003: 대졸자 과정에 맞게 지원 유형 변경, 학과 연락처 추가
-- 지원 유형 목록은 앱에서 검증한다(ENUM → VARCHAR). 기존 값은 그대로 남는다.
ALTER TABLE `{{p}}reservations`
  MODIFY `applicant_type` VARCHAR(30) NOT NULL;

ALTER TABLE `{{p}}departments`
  ADD COLUMN `contact_phone` VARCHAR(30) NULL AFTER `default_location`;
