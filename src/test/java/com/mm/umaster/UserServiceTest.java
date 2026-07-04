/*
package com.mm.umaster;

import com.mm.umaster.account.models.Address;
import com.mm.umaster.account.models.User;
import com.mm.umaster.account.repositories.AddressRepository;
import com.mm.umaster.account.repositories.MasterRepository;
import com.mm.umaster.account.repositories.UserRepository;
import com.mm.umaster.account.services.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.runner.RunWith;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import org.springframework.test.context.junit4.SpringRunner;

import static org.assertj.core.api.AssertionsForClassTypes.assertThat;

@RunWith(SpringRunner.class)
@SpringBootTest
public class UserServiceTest {

    @Mock
    private UserRepository userRepository;
    private MasterRepository masterRepository = Mockito.mock(MasterRepository.class);
    private AddressRepository addressRepository = Mockito.mock(AddressRepository.class);
    private PasswordEncoder passwordEncoder = Mockito.mock(PasswordEncoder.class);

    private UserService userService;

    @BeforeEach
    void initUserService() {
        this.userService = new UserService(userRepository, masterRepository, addressRepository, passwordEncoder);
    }

    @Test
    void saveUser() {

        Address address = new Address();

        address.setCountry("USA");
        address.setCity("New York");
        address.setStreet("Linkoln street");

        User user = new User();
        user.setName("Name");
        user.setEmail("name@email.com");
        user.setPassword("simplePassword");

        user.setAddress(address);

        User savedUser = userService.createNewUserAccount(user);

        System.out.println(savedUser);
        assertThat(savedUser.getId()).isNull();
    }
}
*/
