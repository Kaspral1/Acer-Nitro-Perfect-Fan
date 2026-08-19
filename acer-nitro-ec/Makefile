obj-m := acer-nitro-ec.o

KDIR  ?= /lib/modules/$(shell uname -r)/build
PWD   := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

# CachyOS LLVM kernels: LLVM=1. Ubuntu/gcc: leave unset.
ifneq ($(wildcard $(KDIR)/include/config/CC_IS_CLANG),)
ifneq ($(shell command -v clang 2>/dev/null),)
LLVM ?= 1
endif
endif

all:
	$(MAKE) -C $(KDIR) M="$(PWD)" $(if $(LLVM),LLVM=$(LLVM),) modules

clean:
	$(MAKE) -C $(KDIR) M=$(PWD) clean

install:
	$(MAKE) -C $(KDIR) M=$(PWD) LLVM=$(LLVM) modules_install
	depmod -a

.PHONY: all clean install
