-- ⚠️ هذا الترحيل أصبح قديماً وتم استبداله بالكامل بالملف:
--    20261013130000_create_user_progress_tables.sql
-- أُبقي هنا كسجل تاريخي فقط — لا حاجة لتنفيذه.
--
-- الخلفية: كانت النسخ الأولى تقرأ حالة الإنجاز من العمود المشترك
-- `assignments.completed`، فأي طالب يضع علامة "صح" كانت تظهر عند الجميع.
-- الحل النهائي ينشئ جدولين مستقلّين لكل مستخدم:
--   user_assignment_progress (user_id, assignment_id)
--   user_study_progress     (user_id, task_id)
-- ولا يقرأ ولا يكتب أي عمود `completed` مشترك بعد الآن.

-- UPDATE assignments SET completed = false WHERE completed = true;

