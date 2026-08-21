// SPDX-License-Identifier: GPL-2.0
/*
 * Acer Nitro EC fan control driver
 *
 * Exposes CPU/GPU fan speed control and temperature readings via the
 * standard Linux hwmon interface for Acer Nitro AN515/AN517 laptops.
 *
 * Supported models:
 *   AN515-44, AN515-46, AN515-54, AN515-56, AN515-57, AN515-58, AN517-55
 *
 * Once loaded, the following sysfs entries become available under
 * /sys/class/hwmon/hwmonX/:
 *
 *   fan1_input      - CPU fan speed (RPM)
 *   fan2_input      - GPU fan speed (RPM)
 *   pwm1            - CPU fan duty cycle (0-255)
 *   pwm1_enable     - CPU fan mode: 0=turbo, 1=manual, 2=auto
 *   pwm2            - GPU fan duty cycle (0-255)
 *   pwm2_enable     - GPU fan mode: 0=turbo, 1=manual, 2=auto
 *   temp1_input     - CPU temperature (millidegrees Celsius)
 *   temp2_input     - GPU temperature (millidegrees Celsius)
 *   temp3_input     - System temperature (millidegrees Celsius)
 *
 * On AN515-54 a red keyboard backlight is also exposed:
 *   /sys/devices/platform/acer-nitro-ec/kbd_backlight   (0-4)
 *   /sys/devices/platform/acer-nitro-ec/kbd_timeout     (0/1 = 30s off)
 *
 * Logging:
 *   - Load with debug=1 for verbose output:
 *       sudo insmod acer-nitro-ec.ko debug=1
 *   - Or enable dynamic_debug at runtime (no reload needed):
 *       echo "module acer_nitro_ec +p" > /sys/kernel/debug/dynamic_debug/control
 *   - Watch logs:
 *       sudo dmesg -w | grep acer-nitro-ec
 */

#define DRIVER_NAME "acer-nitro-ec"
#define pr_fmt(fmt) DRIVER_NAME ": " fmt

#include <linux/acpi.h>
#include <linux/dmi.h>
#include <linux/hwmon.h>
#include <linux/init.h>
#include <linux/kernel.h>
#include <linux/module.h>
#include <linux/platform_device.h>
#include <linux/string.h>
#include <linux/sysfs.h>

/* When debug=1, emit dev_dbg messages as dev_info so they appear in dmesg
 * without needing to change the kernel log level or dynamic_debug config.
 */
static bool debug;
module_param(debug, bool, 0644);
MODULE_PARM_DESC(debug, "Enable verbose logging (default: false). "
		 "Can also use: echo 'module acer_nitro_ec +p' > "
		 "/sys/kernel/debug/dynamic_debug/control");

#define nitro_dbg(dev, fmt, ...) do {				\
	if (debug)						\
		dev_info(dev, fmt, ##__VA_ARGS__);		\
	else							\
		dev_dbg(dev, fmt, ##__VA_ARGS__);		\
} while (0)

/* ------------------------------------------------------------------ */
/* EC register map                                                      */
/* ------------------------------------------------------------------ */

struct nitro_ec_regs {
	u8 cpu_fan_mode_ctrl;
	u8 cpu_fan_speed_ctrl;
	u8 cpu_fan_rpm_hi;
	u8 cpu_fan_rpm_lo;
	u8 gpu_fan_mode_ctrl;
	u8 gpu_fan_speed_ctrl;
	u8 gpu_fan_rpm_hi;
	u8 gpu_fan_rpm_lo;
	u8 cpu_temp;
	u8 gpu_temp;
	u8 sys_temp;
};

/* Fan mode EC values */
#define CPU_AUTO_MODE		0x04
#define CPU_MANUAL_MODE		0x0C
#define CPU_TURBO_MODE		0x08
#define GPU_AUTO_MODE		0x10
#define GPU_MANUAL_MODE		0x30
#define GPU_TURBO_MODE		0x20

/* AN515-54 red keyboard: Fn+F10/F9 live level (EC dump). */
#define EC_REG_KBD_BACKLIGHT	0x31
#define EC_REG_KBD_IDLE		0xDE
#define EC_REG_KBD_TIMEOUT	0x06	/* OpeNitro */
#define EC_REG_KBD_SLEEP	0x26	/* SLKB */
#define EC_KBD_TIMEOUT_ON	0x1E	/* 30 s */
#define EC_KBD_TIMEOUT_OFF	0x00
#define KBD_BL_MAX		4

/*
 * AN515-46 register layout — shared by most AN515/AN517 models.
 * Source: reverse-engineered from Linux-NitroSense project.
 */
static const struct nitro_ec_regs regs_an515_46 = {
	.cpu_fan_mode_ctrl  = 0x22,
	.cpu_fan_speed_ctrl = 0x37,
	.cpu_fan_rpm_hi     = 0x13,
	.cpu_fan_rpm_lo     = 0x14,
	.gpu_fan_mode_ctrl  = 0x21,
	.gpu_fan_speed_ctrl = 0x3A,
	.gpu_fan_rpm_hi     = 0x15,
	.gpu_fan_rpm_lo     = 0x16,
	.cpu_temp           = 0xB0,
	.gpu_temp           = 0xB6,
	.sys_temp           = 0xB3,
};

/*
 * AN515-44 differs only in GPU/system temperature register addresses.
 */
static const struct nitro_ec_regs regs_an515_44 = {
	.cpu_fan_mode_ctrl  = 0x22,
	.cpu_fan_speed_ctrl = 0x37,
	.cpu_fan_rpm_hi     = 0x13,
	.cpu_fan_rpm_lo     = 0x14,
	.gpu_fan_mode_ctrl  = 0x21,
	.gpu_fan_speed_ctrl = 0x3A,
	.gpu_fan_rpm_hi     = 0x15,
	.gpu_fan_rpm_lo     = 0x16,
	.cpu_temp           = 0xB0,
	.gpu_temp           = 0xB4,
	.sys_temp           = 0xB0,
};

/* ------------------------------------------------------------------ */
/* Per-device data                                                      */
/* ------------------------------------------------------------------ */

struct nitro_ec_data {
	struct device		  *hwmon_dev;
	const struct nitro_ec_regs *regs;
	bool			   has_kbd_bl;
};

/* ------------------------------------------------------------------ */
/* EC helpers                                                           */
/* ------------------------------------------------------------------ */

static int nitro_ec_read(u8 addr, u8 *val)
{
	int ret = ec_read(addr, val);

	if (ret)
		pr_warn("EC read failed at 0x%02X (err %d)\n", addr, ret);

	return ret;
}

static int nitro_ec_write(u8 addr, u8 val)
{
	int ret = ec_write(addr, val);

	if (ret)
		pr_warn("EC write failed at 0x%02X = 0x%02X (err %d)\n",
			addr, val, ret);

	return ret;
}

/*
 * Read a 16-bit RPM value from two consecutive EC registers.
 * The EC stores the raw fan RPM as a big-endian 16-bit integer.
 */
static int nitro_read_fan_rpm(struct device *dev,
			      const struct nitro_ec_regs *regs, int channel,
			      long *rpm)
{
	u8 hi, lo;
	int ret;

	if (channel == 0) {
		ret = nitro_ec_read(regs->cpu_fan_rpm_hi, &hi);
		if (ret)
			return ret;
		ret = nitro_ec_read(regs->cpu_fan_rpm_lo, &lo);
	} else {
		ret = nitro_ec_read(regs->gpu_fan_rpm_hi, &hi);
		if (ret)
			return ret;
		ret = nitro_ec_read(regs->gpu_fan_rpm_lo, &lo);
	}

	if (ret)
		return ret;

	/*
	 * The EC naming is misleading: the register called "HIGH BITS" (0x13/0x15)
	 * holds the low byte of RPM, and "LOW BITS" (0x14/0x16) holds the high byte.
	 * Confirmed by cross-referencing with the Linux-NitroSense Python implementation:
	 *   cpufanspeed = cpufanspeedLowBits << 8 | cpufanspeedHighBits
	 */
	*rpm = (long)(((u16)lo << 8) | hi);

	nitro_dbg(dev, "%s fan RPM: reg_hi(0x%02X)=0x%02X reg_lo(0x%02X)=0x%02X -> %ld RPM\n",
		  channel == 0 ? "CPU" : "GPU",
		  channel == 0 ? regs->cpu_fan_rpm_hi : regs->gpu_fan_rpm_hi, hi,
		  channel == 0 ? regs->cpu_fan_rpm_lo : regs->gpu_fan_rpm_lo, lo,
		  *rpm);

	return 0;
}

/* ------------------------------------------------------------------ */
/* hwmon callbacks                                                      */
/* ------------------------------------------------------------------ */

static umode_t nitro_hwmon_is_visible(const void *drvdata,
				      enum hwmon_sensor_types type,
				      u32 attr, int channel)
{
	switch (type) {
	case hwmon_fan:
		return 0444;
	case hwmon_pwm:
		return 0644;
	case hwmon_temp:
		return 0444;
	default:
		return 0;
	}
}

static int nitro_hwmon_read(struct device *dev, enum hwmon_sensor_types type,
			    u32 attr, int channel, long *val)
{
	struct nitro_ec_data *data = dev_get_drvdata(dev);
	const struct nitro_ec_regs *regs = data->regs;
	u8 raw;
	int ret;

	switch (type) {

	case hwmon_fan:
		return nitro_read_fan_rpm(dev, regs, channel, val);

	case hwmon_pwm:
		switch (attr) {

		case hwmon_pwm_input:
			ret = nitro_ec_read(channel == 0
					    ? regs->cpu_fan_speed_ctrl
					    : regs->gpu_fan_speed_ctrl, &raw);
			if (ret)
				return ret;
			/* EC uses 0-100%; hwmon expects 0-255 */
			*val = (long)raw * 255 / 100;
			nitro_dbg(dev, "%s pwm read: EC=%u%% hwmon=%ld\n",
				  channel == 0 ? "CPU" : "GPU", raw, *val);
			return 0;

		case hwmon_pwm_enable:
			ret = nitro_ec_read(channel == 0
					    ? regs->cpu_fan_mode_ctrl
					    : regs->gpu_fan_mode_ctrl, &raw);
			if (ret)
				return ret;
			if (channel == 0) {
				if (raw == CPU_TURBO_MODE)
					*val = 0;
				else if (raw == CPU_MANUAL_MODE)
					*val = 1;
				else
					*val = 2; /* auto */
			} else {
				if (raw == GPU_TURBO_MODE)
					*val = 0;
				else if (raw == GPU_MANUAL_MODE)
					*val = 1;
				else
					*val = 2; /* auto */
			}
			nitro_dbg(dev,
				  "%s mode read: EC=0x%02X -> pwm_enable=%ld "
				  "(0=turbo 1=manual 2=auto)\n",
				  channel == 0 ? "CPU" : "GPU", raw, *val);
			return 0;
		}
		break;

	case hwmon_temp: {
		static const char * const temp_names[] = {
			"CPU", "GPU", "system"
		};
		switch (channel) {
		case 0: ret = nitro_ec_read(regs->cpu_temp, &raw); break;
		case 1: ret = nitro_ec_read(regs->gpu_temp, &raw); break;
		case 2: ret = nitro_ec_read(regs->sys_temp, &raw); break;
		default: return -EOPNOTSUPP;
		}
		if (ret)
			return ret;
		*val = (long)raw * 1000; /* millidegrees */
		nitro_dbg(dev, "%s temp: %u°C\n", temp_names[channel], raw);
		return 0;
	}

	default:
		break;
	}

	return -EOPNOTSUPP;
}

static int nitro_hwmon_write(struct device *dev, enum hwmon_sensor_types type,
			     u32 attr, int channel, long val)
{
	struct nitro_ec_data *data = dev_get_drvdata(dev);
	const struct nitro_ec_regs *regs = data->regs;
	u8 ec_val;

	switch (type) {

	case hwmon_pwm:
		switch (attr) {

		case hwmon_pwm_input:
			if (val < 0 || val > 255)
				return -EINVAL;
			/* Scale 0-255 → 0-100 */
			ec_val = (u8)(val * 100 / 255);
			dev_info(dev, "%s fan speed set: hwmon=%ld -> EC=%u%%\n",
				 channel == 0 ? "CPU" : "GPU", val, ec_val);
			return nitro_ec_write(channel == 0
					      ? regs->cpu_fan_speed_ctrl
					      : regs->gpu_fan_speed_ctrl,
					      ec_val);

		case hwmon_pwm_enable: {
			/*
			 * 0 = turbo (full speed, firmware-forced)
			 * 1 = manual (controlled via pwm attribute)
			 * 2 = automatic (firmware manages speed)
			 */
			static const char * const mode_names[] = {
				"turbo", "manual", "auto"
			};
			if (val < 0 || val > 2)
				return -EINVAL;
			if (channel == 0) {
				if (val == 0)
					ec_val = CPU_TURBO_MODE;
				else if (val == 1)
					ec_val = CPU_MANUAL_MODE;
				else
					ec_val = CPU_AUTO_MODE;
				dev_info(dev,
					 "CPU fan mode set: %s (EC=0x%02X)\n",
					 mode_names[val], ec_val);
				return nitro_ec_write(regs->cpu_fan_mode_ctrl,
						      ec_val);
			} else {
				if (val == 0)
					ec_val = GPU_TURBO_MODE;
				else if (val == 1)
					ec_val = GPU_MANUAL_MODE;
				else
					ec_val = GPU_AUTO_MODE;
				dev_info(dev,
					 "GPU fan mode set: %s (EC=0x%02X)\n",
					 mode_names[val], ec_val);
				return nitro_ec_write(regs->gpu_fan_mode_ctrl,
						      ec_val);
			}
		}
		}
		break;

	default:
		break;
	}

	return -EOPNOTSUPP;
}

/* ------------------------------------------------------------------ */
/* hwmon chip descriptor                                                */
/* ------------------------------------------------------------------ */

static const struct hwmon_channel_info * const nitro_hwmon_info[] = {
	HWMON_CHANNEL_INFO(fan,
		HWMON_F_INPUT,   /* fan1 = CPU */
		HWMON_F_INPUT),  /* fan2 = GPU */
	HWMON_CHANNEL_INFO(pwm,
		HWMON_PWM_INPUT | HWMON_PWM_ENABLE,  /* pwm1 = CPU */
		HWMON_PWM_INPUT | HWMON_PWM_ENABLE), /* pwm2 = GPU */
	HWMON_CHANNEL_INFO(temp,
		HWMON_T_INPUT,   /* temp1 = CPU */
		HWMON_T_INPUT,   /* temp2 = GPU */
		HWMON_T_INPUT),  /* temp3 = system */
	NULL
};

static const struct hwmon_ops nitro_hwmon_ops = {
	.is_visible = nitro_hwmon_is_visible,
	.read       = nitro_hwmon_read,
	.write      = nitro_hwmon_write,
};

static const struct hwmon_chip_info nitro_chip_info = {
	.ops  = &nitro_hwmon_ops,
	.info = nitro_hwmon_info,
};

/* ------------------------------------------------------------------ */
/* Keyboard backlight (AN515-54 red 5-level) — platform sysfs           */
/* ------------------------------------------------------------------ */

static int nitro_kbd_read_level(u8 *val)
{
	int ret = nitro_ec_read(EC_REG_KBD_BACKLIGHT, val);

	if (ret)
		return ret;
	if (*val > KBD_BL_MAX)
		*val = KBD_BL_MAX;
	return 0;
}

static int nitro_kbd_write_level(unsigned int level)
{
	if (level > KBD_BL_MAX)
		return -EINVAL;
	if (level > 0)
		nitro_ec_write(EC_REG_KBD_IDLE, 0);
	return nitro_ec_write(EC_REG_KBD_BACKLIGHT, (u8)level);
}

static bool nitro_model_has_red_kbd(void)
{
	const char *model = dmi_get_system_info(DMI_PRODUCT_NAME);

	return model && strstr(model, "AN515-54");
}

static bool nitro_kbd_timeout_enabled(void)
{
	u8 a = 0, b = 0;

	nitro_ec_read(EC_REG_KBD_TIMEOUT, &a);
	nitro_ec_read(EC_REG_KBD_SLEEP, &b);
	return a == EC_KBD_TIMEOUT_ON || b == EC_KBD_TIMEOUT_ON;
}

static int nitro_kbd_timeout_set(bool enabled)
{
	u8 val = enabled ? EC_KBD_TIMEOUT_ON : EC_KBD_TIMEOUT_OFF;
	int ret;

	ret = nitro_ec_write(EC_REG_KBD_TIMEOUT, val);
	if (ret)
		return ret;
	ret = nitro_ec_write(EC_REG_KBD_SLEEP, val);
	if (!enabled)
		nitro_ec_write(EC_REG_KBD_IDLE, 0);
	return ret;
}

static ssize_t kbd_backlight_show(struct device *dev,
				  struct device_attribute *attr, char *buf)
{
	u8 val;

	if (nitro_kbd_read_level(&val))
		return -EIO;
	return sysfs_emit(buf, "%u\n", val);
}

static ssize_t kbd_backlight_store(struct device *dev,
				   struct device_attribute *attr,
				   const char *buf, size_t count)
{
	unsigned int level;
	int ret;

	ret = kstrtouint(buf, 0, &level);
	if (ret)
		return ret;
	ret = nitro_kbd_write_level(level);
	return ret ? ret : count;
}

static ssize_t kbd_timeout_show(struct device *dev,
				struct device_attribute *attr, char *buf)
{
	return sysfs_emit(buf, "%u\n", nitro_kbd_timeout_enabled() ? 1 : 0);
}

static ssize_t kbd_timeout_store(struct device *dev,
				 struct device_attribute *attr,
				 const char *buf, size_t count)
{
	unsigned int on;
	int ret;

	ret = kstrtouint(buf, 0, &on);
	if (ret)
		return ret;
	if (on > 1)
		return -EINVAL;
	ret = nitro_kbd_timeout_set(on == 1);
	return ret ? ret : count;
}

static DEVICE_ATTR_RW(kbd_backlight);
static DEVICE_ATTR_RW(kbd_timeout);

static struct attribute *nitro_kbd_attrs[] = {
	&dev_attr_kbd_backlight.attr,
	&dev_attr_kbd_timeout.attr,
	NULL,
};

static const struct attribute_group nitro_kbd_group = {
	.attrs = nitro_kbd_attrs,
};

/* ------------------------------------------------------------------ */
/* Platform driver                                                      */
/* ------------------------------------------------------------------ */

static int nitro_ec_probe(struct platform_device *pdev)
{
	const struct nitro_ec_regs *regs;
	struct nitro_ec_data *data;
	int ret;

	regs = dev_get_platdata(&pdev->dev);
	if (!regs) {
		dev_err(&pdev->dev, "no platform data — aborting probe\n");
		return -ENODEV;
	}

	dev_dbg(&pdev->dev, "EC register map:\n"
		"  CPU fan mode=0x%02X speed=0x%02X rpm=0x%02X/0x%02X\n"
		"  GPU fan mode=0x%02X speed=0x%02X rpm=0x%02X/0x%02X\n"
		"  Temps: cpu=0x%02X gpu=0x%02X sys=0x%02X\n",
		regs->cpu_fan_mode_ctrl, regs->cpu_fan_speed_ctrl,
		regs->cpu_fan_rpm_hi,    regs->cpu_fan_rpm_lo,
		regs->gpu_fan_mode_ctrl, regs->gpu_fan_speed_ctrl,
		regs->gpu_fan_rpm_hi,    regs->gpu_fan_rpm_lo,
		regs->cpu_temp, regs->gpu_temp, regs->sys_temp);

	data = devm_kzalloc(&pdev->dev, sizeof(*data), GFP_KERNEL);
	if (!data)
		return -ENOMEM;

	data->regs = regs;
	platform_set_drvdata(pdev, data);

	data->hwmon_dev = devm_hwmon_device_register_with_info(
		&pdev->dev, "acer_nitro_ec", data,
		&nitro_chip_info, NULL);

	if (IS_ERR(data->hwmon_dev)) {
		dev_err(&pdev->dev, "hwmon registration failed: %ld\n",
			PTR_ERR(data->hwmon_dev));
		return PTR_ERR(data->hwmon_dev);
	}

	dev_info(&pdev->dev, "hwmon interface registered at %s\n",
		 dev_name(data->hwmon_dev));

	if (nitro_model_has_red_kbd()) {
		ret = devm_device_add_group(&pdev->dev, &nitro_kbd_group);
		if (ret) {
			dev_err(&pdev->dev,
				"kbd sysfs group failed: %d\n", ret);
			return ret;
		}
		data->has_kbd_bl = true;
		dev_info(&pdev->dev,
			 "kbd_backlight 0-%d and kbd_timeout on %s\n",
			 KBD_BL_MAX, dev_name(&pdev->dev));
	}

	if (debug)
		dev_info(&pdev->dev, "verbose logging enabled\n");

	return 0;
}

static struct platform_driver nitro_ec_driver = {
	.probe  = nitro_ec_probe,
	.driver = {
		.name = DRIVER_NAME,
	},
};

/* ------------------------------------------------------------------ */
/* Module init/exit — DMI-based device detection                       */
/* ------------------------------------------------------------------ */

static struct platform_device *nitro_pdev;

static int __init nitro_ec_init(void)
{
	const struct nitro_ec_regs *regs = NULL;
	const char *model;
	int ret;

	model = dmi_get_system_info(DMI_PRODUCT_NAME);
	if (!model)
		return -ENODEV;

	if (strstr(model, "AN515-44"))
		regs = &regs_an515_44;
	else if (strstr(model, "AN515-46") ||
		 strstr(model, "AN515-54") ||
		 strstr(model, "AN515-56") ||
		 strstr(model, "AN515-57") ||
		 strstr(model, "AN515-58") ||
		 strstr(model, "AN517-55"))
		regs = &regs_an515_46;

	if (!regs) {
		pr_info("unsupported model '%s' — not loading\n", model);
		return -ENODEV;
	}

	pr_info("detected '%s', loading driver\n", model);

	ret = platform_driver_register(&nitro_ec_driver);
	if (ret) {
		pr_err("platform_driver_register failed: %d\n", ret);
		return ret;
	}

	nitro_pdev = platform_device_register_data(
		NULL, DRIVER_NAME, PLATFORM_DEVID_NONE,
		regs, sizeof(*regs));

	if (IS_ERR(nitro_pdev)) {
		pr_err("platform_device_register failed: %ld\n",
		       PTR_ERR(nitro_pdev));
		platform_driver_unregister(&nitro_ec_driver);
		return PTR_ERR(nitro_pdev);
	}

	return 0;
}

static void __exit nitro_ec_exit(void)
{
	pr_info("unloading driver\n");
	platform_device_unregister(nitro_pdev);
	platform_driver_unregister(&nitro_ec_driver);
}

module_init(nitro_ec_init);
module_exit(nitro_ec_exit);

MODULE_AUTHOR("Linux-NitroSense contributors");
MODULE_DESCRIPTION("Acer Nitro AN515/AN517 EC fan control driver");
MODULE_LICENSE("GPL");
MODULE_ALIAS("dmi:*:svnAcer:pnNitroAN515*:");
MODULE_ALIAS("dmi:*:svnAcer:pnNitroAN517*:");
