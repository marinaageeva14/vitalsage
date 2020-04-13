package com.mm.umaster.account.models;

import org.springframework.security.core.GrantedAuthority;

public enum RoleType implements GrantedAuthority {
    ROLE_MASTER,
    USER;

    @Override
    public String getAuthority() {
        return name();
    }
}
