const fs = require('fs');
const path = require('path');

const REQUIRED_KEYS = [
  "system_optimal",
  "profiles_title",
  "profile_silent_name",
  "profile_balanced_name",
  "profile_turbo_name",
  "working_mode_title",
  "manual_control_label",
  "mode_auto_btn",
  "mode_manual_btn",
  "logging_section_title",
  "logging_label",
  "menu_btn_label",
  "menu_header_title",
  "menu_summary_label",
  "menu_open_logs_label",
  "summary_modal_title",
  "btn_copy_report",
  "btn_close",
  "mode_auto_desc",
  "mode_auto_status",
  "mode_manual_desc",
  "resources_title",
  "cpu_clock_label",
  "other_sensors_title",
  "kbd_backlight_title",
  "kbd_timeout_label",
  "kbd_timeout_no",
  "kbd_timeout_yes",
  "kbd_driver_missing",
  "loading_sensors",
  "no_sensors",
  "cpu_header",
  "gpu_header",
  "pwm_fill",
  "manual_sliders_title",
  "master_slider_label",
  "cpu_fan_label",
  "gpu_fan_label",
  "btn_reset",
  "btn_restore_auto",
  "curve_editor_title",
  "curve_profile_turbo",
  "curve_profile_balanced",
  "curve_profile_silent",
  "point_col",
  "temp_col",
  "rpm_col",
  "curve_source_default",
  "curve_source_custom",
  "save_curve_btn",
  "temp_history_title",
  "daemon_status_label",
  "working_mode_label",
  "connected",
  "disconnected",
  "tooltip_auto_mode",
  "offset_title",
  "offset_label",
  "offset_desc_zero",
  "offset_desc_plus",
  "offset_desc_minus",
  "toast_offset_set",
  "toast_offset_linked",
  "system_offline",
  "disclaimer_text",
  "toast_enable_manual",
  "toast_fan_speed_set",
  "toast_profile_activated",
  "toast_manual_mode_active",
  "toast_auto_mode_active",
  "toast_enable_manual_reset",
  "toast_speed_zero",
  "toast_speed_min",
  "toast_speed_reset_success",
  "toast_curve_saved_sorted",
  "toast_curve_saved_success",
  "sensor_cpu_package",
  "sensor_nvme",
  "sensor_gpu",
  "sensor_pch",
  "sensor_vrm",
  "sensor_chassis",
  "close_confirm_title",
  "close_confirm_text",
  "close_dont_ask",
  "close_btn_cancel",
  "close_btn_minimize",
  "close_btn_quit",
  "settings_btn_label",
  "settings_header_title",
  "settings_close_label",
  "settings_close_ask",
  "settings_close_minimize",
  "settings_close_quit",
  "settings_show_disclaimer",
  "settings_reset_close",
  "settings_edit_defaults",
  "defaults_modal_title",
  "defaults_modal_hint",
  "defaults_btn_save",
  "defaults_edited_msg",
  "defaults_btn_restore",
  "toast_defaults_saved",
  "toast_defaults_restored",
  "toast_defaults_need_points",
  "power_profiles_title",
  "power_low_power",
  "power_quiet",
  "power_balanced",
  "power_sport",
  "power_performance",
  "power_hint_low_power",
  "power_hint_quiet",
  "power_hint_balanced",
  "power_hint_sport",
  "power_hint_performance",
  "power_offline",
  "power_status_label",
  "toast_power_profile",
  "toast_power_profile_fail",
  "settings_licenses",
  "settings_github",
  "settings_tab_general",
  "settings_tab_theme",
  "theme_hint",
  "theme_nitro_name",
  "theme_nitro_desc",
  "theme_outrun_name",
  "theme_outrun_desc",
  "toast_theme_applied",
  "power_license_credit",
  "license_modal_title",
  "license_app_heading",
  "license_app_body",
  "license_damx_heading",
  "license_damx_body",
  "license_damx_link",
  "license_linuwu_link",
  "license_ec_heading",
  "license_ec_body",
  "summary_loading",
  "summary_session_title",
  "summary_runtime",
  "summary_samples",
  "summary_sample_interval",
  "summary_log_range",
  "summary_cpu_title",
  "summary_gpu_title",
  "summary_avg_temp",
  "summary_max_temp",
  "summary_min_temp",
  "summary_time_at_max",
  "summary_avg_fan",
  "summary_fan_value",
  "summary_avg_cpu_load",
  "summary_zero_rpm",
  "summary_unit_hours",
  "summary_unit_minutes",
  "summary_unit_seconds",
  "summary_report_title",
  "summary_report_runtime",
  "summary_report_samples",
  "summary_report_range",
  "summary_report_cpu",
  "summary_report_gpu",
  "summary_report_temps",
  "summary_report_time_at_max",
  "summary_report_fan",
  "summary_report_load",
  "summary_report_zero_rpm"
];

const LANGUAGES = ['pl', 'en', 'es', 'de', 'cs'];
let failed = false;

LANGUAGES.forEach(lang => {
  console.log(`Checking language: ${lang}...`);
  const filePath = path.join(__dirname, 'i18n', `${lang}.json`);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File ${lang}.json does not exist.`);
    failed = true;
    return;
  }
  
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const translations = JSON.parse(fileContent);
    
    REQUIRED_KEYS.forEach(key => {
      if (translations[key] === undefined) {
        console.error(`Error in ${lang}.json: Missing translation key "${key}"`);
        failed = true;
      } else if (typeof translations[key] !== 'string' || translations[key].length === 0) {
        console.error(`Error in ${lang}.json: Key "${key}" is not a valid non-empty string`);
        failed = true;
      }
    });
  } catch (err) {
    console.error(`Error parsing ${lang}.json:`, err.message);
    failed = true;
  }
});

if (failed) {
  console.error("i18n validation FAILED.");
  process.exit(1);
} else {
  console.log("i18n validation PASSED successfully.");
  process.exit(0);
}
